import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { FREE_DAILY_REROLLS, getUtcDateKey } from "@/lib/constants";
import { QuestCategory } from "@/lib/quests";
import { GeneratedQuest } from "@/lib/generate";
import { NearbyPlace } from "@/lib/nearby";
import {
  SYSTEM_PROMPT,
  buildUserMessage,
  normalize,
  scrub,
  findSafetyViolation,
  isUiCategory,
  clamp,
  type GenerateBody,
  type ClaudeQuest,
  type GroupSizeBand,
} from "../route";

// Additive streaming sibling of /api/generate. The JSON endpoint is unchanged
// and remains the contract the mobile app (M12.3) depends on. This route emits
// quests over Server-Sent Events so the web client can render the first quest
// as soon as the model finishes it — perceived latency well under the full
// generation time. It reuses the exact same prompt + per-quest safety helpers
// as the JSON path, so quality/safety cannot drift.
//
// NOTE: the reroll gate + charge logic below is intentionally duplicated from
// route.ts rather than shared, to guarantee this new path can never alter the
// behavior of the mobile-critical JSON handler. Unify once streaming is
// validated in production.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const enc = new TextEncoder();
function sse(event: Record<string, unknown>): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Incremental, string-aware brace matcher. Fed the growing buffer on each
 * delta, it returns any newly-completed top-level `{...}` objects from the
 * streamed JSON array. State (depth/position) persists across calls via the
 * returned cursor object.
 */
type ScanState = {
  i: number;
  depth: number;
  inStr: boolean;
  esc: boolean;
  objStart: number;
};
function makeScanState(): ScanState {
  return { i: 0, depth: 0, inStr: false, esc: false, objStart: -1 };
}
function scanObjects(buf: string, s: ScanState): string[] {
  const out: string[] = [];
  for (; s.i < buf.length; s.i++) {
    const c = buf[s.i];
    if (s.inStr) {
      if (s.esc) s.esc = false;
      else if (c === "\\") s.esc = true;
      else if (c === '"') s.inStr = false;
      continue;
    }
    if (c === '"') {
      s.inStr = true;
    } else if (c === "{") {
      if (s.depth === 0) s.objStart = s.i;
      s.depth++;
    } else if (c === "}") {
      s.depth--;
      if (s.depth === 0 && s.objStart >= 0) {
        out.push(buf.slice(s.objStart, s.i + 1));
        s.objStart = -1;
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set" },
      { status: 503 },
    );
  }

  // ----- reroll gate (mirrors /api/generate; runs before any streaming) -----
  const dateKey = getUtcDateKey();
  const supabase = createClient(req);
  const {
    data: { user: gateUser },
  } = await supabase.auth.getUser();
  let meterFreeUser = false;
  let responseTier: "free" | "pro" = "free";
  if (gateUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier, tier_expires_at, daily_rerolls")
      .eq("id", gateUser.id)
      .maybeSingle();
    responseTier = profile?.tier === "pro" ? "pro" : "free";
    const isPro =
      profile?.tier === "pro" &&
      (!profile.tier_expires_at ||
        new Date(profile.tier_expires_at).getTime() > Date.now());
    if (!isPro) {
      meterFreeUser = true;
      const used = profile?.daily_rerolls?.[dateKey] ?? 0;
      if (used >= FREE_DAILY_REROLLS) {
        // Same 402 contract as the JSON route so the client opens the upsell.
        return NextResponse.json(
          {
            error: "reroll_limit",
            requiresUpgrade: true,
            rerollsToday: used,
            resetAt: "midnight UTC",
          },
          { status: 402 },
        );
      }
    }
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const location = (body.location ?? "").trim() || "your area";
  const region = (body.region ?? "").trim() || location;
  const places: Array<Pick<NearbyPlace, "name" | "type">> = Array.isArray(
    body.nearbyPlaces,
  )
    ? body.nearbyPlaces
        .filter(
          (p) => p && typeof p.name === "string" && typeof p.type === "string",
        )
        .slice(0, 20)
    : [];
  const typeCounts: Record<string, number> =
    body.typeCounts && typeof body.typeCounts === "object"
      ? body.typeCounts
      : (() => {
          const tc: Record<string, number> = {};
          for (const p of places) tc[p.type] = (tc[p.type] ?? 0) + 1;
          return tc;
        })();
  const spiceLevel = clamp(Math.round(Number(body.spiceLevel) || 5), 1, 10);
  const groupSize: GroupSizeBand =
    body.groupSize === "solo" ||
    body.groupSize === "2" ||
    body.groupSize === "group"
      ? body.groupSize
      : "group";
  const timeAvailable = clamp(
    Math.round(Number(body.timeAvailable) || 90),
    5,
    360,
  );
  const excludeIds = Array.isArray(body.excludeIds)
    ? body.excludeIds.slice(0, 200)
    : [];
  const previousTitles = Array.isArray(body.previousTitles)
    ? body.previousTitles.filter((t) => typeof t === "string").slice(-9)
    : [];
  const categoryRaw =
    typeof body.category === "string" ? body.category.trim() : "";
  const requestedCategory =
    categoryRaw && categoryRaw.toLowerCase() !== "all" ? categoryRaw : null;
  const canDrive = body.canDrive !== false;
  const lowCostOnly = body.lowCostOnly === true;

  const { userMessage, histogram } = buildUserMessage({
    region,
    spiceLevel,
    groupSize,
    timeAvailable,
    requestedCategory,
    canDrive,
    lowCostOnly,
    typeCounts,
    previousTitles,
  });

  // Defaults the model no longer emits — filled from the user's own request.
  const groupRange =
    groupSize === "solo"
      ? { min: 1, max: 3 }
      : groupSize === "2"
        ? { min: 2, max: 4 }
        : { min: 3, max: 6 };
  const tMin = clamp(Math.round(timeAvailable * 0.6), 5, 345);
  const tMax = clamp(Math.max(timeAvailable, tMin + 15), 5, 360);
  const normalizeDefaults = {
    spice: spiceLevel,
    time: { min: tMin, max: tMax },
    group: groupRange,
  };
  const categoryOverride: QuestCategory | null =
    requestedCategory && isUiCategory(requestedCategory)
      ? requestedCategory
      : null;

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "extended-cache-ttl-2025-04-11" },
  });

  const t0 = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const seen = new Set<string>(excludeIds);
      const emitted: GeneratedQuest[] = [];
      let firstQuestMs = 0;
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 25_000);

      // Decide whether a freshly-completed quest may be revealed, then push it.
      // Per-quest safety runs here: a quest that still trips a hard safety rule
      // after scrub() is HELD (never emitted) rather than shown and retracted.
      function consider(raw: string): void {
        if (emitted.length >= 3) return;
        let q: ClaudeQuest;
        try {
          q = JSON.parse(raw) as ClaudeQuest;
        } catch {
          return;
        }
        if (!q || typeof q.title !== "string" || typeof q.description !== "string") {
          return;
        }
        // Strip any leaked venue names first (matches the JSON path).
        scrub([q], places);
        const haystack = `${q.title} ${q.description}`;
        // SAFETY is the ONLY reason to suppress a streamed quest — a quest that
        // still trips a hard safety rule after scrub() is held (never shown).
        // We deliberately do NOT drop for food-density or title dupes here: the
        // JSON path ships those as-is (post #43), and dropping them mid-stream
        // with no top-up was silently yielding 2 quests instead of 3 in
        // food-dense areas. Keeping parity guarantees 3 unless a rare genuine
        // safety hold applies.
        if (findSafetyViolation(haystack)) {
          console.log("[generate/stream] held unsafe quest", { title: q.title });
          return;
        }
        const normalized = normalize(q, seen, categoryOverride, normalizeDefaults);
        if (!normalized) return;
        emitted.push(normalized);
        if (!firstQuestMs) firstQuestMs = Date.now() - t0;
        ctrl.enqueue(sse({ type: "quest", quest: normalized }));
      }

      try {
        const llm = client.messages.stream(
          {
            model: "claude-haiku-4-5",
            max_tokens: 384,
            temperature: 0.75,
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            messages: [{ role: "user", content: userMessage }],
          },
          { signal: abort.signal },
        );

        let buf = "";
        const scan = makeScanState();
        for await (const event of llm) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            buf += event.delta.text;
            for (const obj of scanObjects(buf, scan)) {
              consider(obj);
              if (emitted.length >= 3) break;
            }
            if (emitted.length >= 3) break;
          }
        }
        // Insurance: flush any complete object still buffered when the stream
        // ended (e.g. the final quest, closed by `}]` with no trailing comma).
        if (emitted.length < 3) {
          for (const obj of scanObjects(buf, scan)) {
            consider(obj);
            if (emitted.length >= 3) break;
          }
        }
        clearTimeout(timer);

        // Charge the reroll only once at least one quest actually shipped.
        let rerollsRemaining: number | null = null;
        if (meterFreeUser && emitted.length > 0) {
          const { data: newCount } = await supabase.rpc(
            "increment_daily_reroll",
            { p_date_key: dateKey },
          );
          rerollsRemaining = Math.max(
            0,
            FREE_DAILY_REROLLS - (typeof newCount === "number" ? newCount : 0),
          );
        }

        console.log("[generate/stream] timing", {
          totalMs: Date.now() - t0,
          firstQuestMs,
          emitted: emitted.length,
          region,
          histogram,
        });
        console.log("[generate/stream] result", {
          location,
          region,
          quests: emitted.map((q) => ({
            title: q.title,
            description: q.description,
            category: q.category,
            spice: q.spice,
          })),
        });

        if (emitted.length === 0) {
          ctrl.enqueue(sse({ type: "error", error: "no valid quests" }));
        } else {
          ctrl.enqueue(
            sse({
              type: "done",
              tier: responseTier,
              rerollsRemaining,
              count: emitted.length,
            }),
          );
        }
      } catch (err) {
        clearTimeout(timer);
        console.log("[generate/stream] error", err);
        // If some quests already streamed, the client keeps them; otherwise it
        // can fall back to the JSON endpoint.
        ctrl.enqueue(
          sse({
            type: "error",
            error: err instanceof Error ? err.message : "stream failed",
            partial: emitted.length,
          }),
        );
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
