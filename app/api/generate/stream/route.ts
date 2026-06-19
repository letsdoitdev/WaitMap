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
  extractJsonArray,
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

      // True iff the quest survives the per-quest gate: valid shape, and after
      // scrub() it does not trip a hard safety rule. SAFETY is the ONLY reason
      // a quest is withheld (we do NOT drop for food-density or dupes — the
      // JSON path ships those as-is post #43).
      function isSafe(q: ClaudeQuest): boolean {
        if (
          !q ||
          typeof q.title !== "string" ||
          typeof q.description !== "string"
        ) {
          return false;
        }
        scrub([q], places); // strip leaked venue names in place (matches JSON path)
        if (findSafetyViolation(`${q.title} ${q.description}`)) {
          console.log("[generate/stream] held unsafe quest", { title: q.title });
          return false;
        }
        return true;
      }

      // Normalize + emit one already-safe, already-scrubbed quest.
      function emit(q: ClaudeQuest): void {
        const normalized = normalize(q, seen, categoryOverride, normalizeDefaults);
        if (!normalized) return;
        emitted.push(normalized);
        if (!firstQuestMs) firstQuestMs = Date.now() - t0;
        ctrl.enqueue(sse({ type: "quest", quest: normalized }));
      }

      // Progressive path: a freshly-completed streamed object → emit if safe.
      function consider(raw: string): void {
        if (emitted.length >= 3) return;
        let q: ClaudeQuest;
        try {
          q = JSON.parse(raw) as ClaudeQuest;
        } catch {
          return;
        }
        if (isSafe(q)) emit(q);
      }

      try {
        const llm = client.messages.stream(
          {
            model: "claude-haiku-4-5",
            // Headroom so the 3rd quest object always closes before the model
            // stops — a tighter 384 ceiling could truncate it mid-stream on a
            // longer batch, leaving only 2 parseable objects. Typical output is
            // ~250 tokens, so this does not change normal latency.
            max_tokens: 600,
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

        // Progressive emission is best-effort and purely cosmetic: render each
        // quest the moment the SDK surfaces its completed object. Reliability of
        // the FINAL count does NOT depend on this — see the authoritative
        // reconcile below. Using .on("text") (SDK-accumulated deltas) instead of
        // raw-event iteration avoids any event-shape/tail edge cases.
        let buf = "";
        const scan = makeScanState();
        llm.on("text", (delta: string) => {
          if (emitted.length >= 3) return;
          buf += delta;
          for (const obj of scanObjects(buf, scan)) {
            consider(obj);
            if (emitted.length >= 3) break;
          }
        });

        // Authoritative reconcile: finalMessage() is the COMPLETE response. We
        // parse it with the SAME extractJsonArray() the reliable JSON path uses,
        // filter to the safe set IN ORDER, and emit the suffix the progressive
        // pass hasn't sent yet (matched by position, not title — so a missed
        // tail OR a duplicate title still yields 3). This makes the stream's
        // final count equal to the JSON path's.
        const finalMsg = await llm.finalMessage();
        clearTimeout(timer);
        const stopReason = finalMsg.stop_reason ?? null;
        const tb = finalMsg.content.find((b) => b.type === "text");
        const fullText = tb && tb.type === "text" ? tb.text : buf;

        let parsedLen = 0;
        if (emitted.length < 3) {
          let parsed: unknown = null;
          try {
            parsed = extractJsonArray(fullText);
          } catch {
            parsed = null;
          }
          if (Array.isArray(parsed)) {
            parsedLen = parsed.length;
            // Safe set in model order; the progressive pass already emitted a
            // prefix of exactly this list, so emit from emitted.length onward.
            const safe = (parsed as ClaudeQuest[]).filter((q) => isSafe(q));
            for (let i = emitted.length; i < safe.length && emitted.length < 3; i++) {
              emit(safe[i]);
            }
          }
        }

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
          // Diagnosis aids: parsedLen is how many objects the authoritative
          // full-message parse found. parsedLen===3 + emitted<3 would mean the
          // reconcile/emit dropped one; parsedLen<3 + stopReason "end_turn"
          // means the model truly produced fewer; stopReason "max_tokens" means
          // genuine truncation.
          parsedLen,
          stopReason,
          textLen: fullText.length,
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
