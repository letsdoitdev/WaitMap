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
  sanitizeCostPref,
  sanitizeVibes,
  sanitizeLocalTime,
  sanitizePreviousTitles,
  sanitizeRegion,
  sanitizeTypeCounts,
  isNearDuplicate,
  isFoodQuest,
  preferredV4Categories,
  type GenerateBody,
  type ClaudeQuest,
  type GroupSizeBand,
} from "../route";
import {
  hardFilterQuests,
  requiresCar,
  requiresSpend,
  selectTopQuests,
} from "@/lib/quest-ranker";

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

  const location = sanitizeRegion(body.location) || "your area";
  const region = sanitizeRegion(body.region) || location;
  const places: Array<Pick<NearbyPlace, "name" | "type">> = Array.isArray(
    body.nearbyPlaces,
  )
    ? body.nearbyPlaces
        .filter(
          (p) => p && typeof p.name === "string" && typeof p.type === "string",
        )
        .slice(0, 20)
    : [];
  const typeCounts: Record<string, number> = sanitizeTypeCounts(
    body.typeCounts && typeof body.typeCounts === "object"
      ? body.typeCounts
      : (() => {
          const tc: Record<string, number> = {};
          for (const p of places) tc[p.type] = (tc[p.type] ?? 0) + 1;
          return tc;
        })(),
  );
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
  const previousTitles = sanitizePreviousTitles(body.previousTitles);
  const categoryRaw =
    typeof body.category === "string" ? body.category.trim() : "";
  const requestedCategory =
    categoryRaw && categoryRaw.toLowerCase() !== "all" ? categoryRaw : null;
  const canDrive = body.canDrive !== false;
  const costPref = sanitizeCostPref(body.costPref, body.lowCostOnly === true);
  const vibes = sanitizeVibes(body.vibeCategories);
  const localTime = sanitizeLocalTime(body.localHour, body.localWeekday);

  // Overgenerate-and-rank (mirrors the JSON path): request 6 candidates,
  // ship the best 3. Hybrid emission strategy — the FIRST candidate that
  // passes the hard checks is emitted the moment its object closes, so
  // first-card latency is unchanged; slots 2-3 are ranked over the full
  // candidate pool once the stream completes. Chosen over buffer-everything
  // because the whole point of this endpoint is time-to-first-card.
  const BATCH_COUNT = 6;
  const TARGET_COUNT = 3;

  const { userMessage, histogram } = buildUserMessage({
    region,
    spiceLevel,
    groupSize,
    timeAvailable,
    requestedCategory,
    canDrive,
    costPref,
    vibes,
    localTime,
    typeCounts,
    previousTitles,
    count: BATCH_COUNT,
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
      let heldCount = 0; // distinct quests dropped for a hard safety rule
      // Owner-review record of what the per-quest safety filter culled, so
      // false-positives (over-aggressive rules) can be told apart from real
      // catches. Deduped by title so a quest re-checked by the reconcile path
      // is recorded once.
      const held: Array<{
        title: string;
        rule: string;
        match: string;
        description: string;
      }> = [];
      const heldSeen = new Set<string>();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 25_000);

      // True iff the quest survives the per-quest safety gate: valid shape,
      // and after scrub() it does not trip a hard safety rule. Near-dup and
      // constraint drops live in passesHardChecks/hardFilterQuests below.
      function isSafe(q: ClaudeQuest): boolean {
        if (
          !q ||
          typeof q.title !== "string" ||
          typeof q.description !== "string"
        ) {
          return false;
        }
        scrub([q], places); // strip leaked venue names in place (matches JSON path)
        const v = findSafetyViolation(`${q.title} ${q.description}`);
        if (v) {
          const key = q.title.trim().toLowerCase();
          if (!heldSeen.has(key)) {
            heldSeen.add(key);
            heldCount++;
            held.push({
              title: q.title,
              rule: v.name,
              match: v.match,
              description: q.description,
            });
            // Per-quest review line: the rule that fired + the exact substring
            // that matched + the full quest, so the owner can judge whether the
            // hold was a false positive. Safety thresholds are left as-is.
            console.log("[generate/stream] held", {
              title: q.title,
              rule: v.name,
              match: v.match,
              description: q.description,
            });
          }
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

      // Full hard-check pipeline for the progressive first-card path —
      // shape+scrub+safety via isSafe (held logging), then near-dup and
      // detectable constraint violations, mirroring lib/quest-ranker's
      // hardFilterQuests order. Deduped drop counter for diagnostics.
      const walkingOnly = !canDrive;
      const freeOnly = costPref === "free";
      const dropSeen = new Set<string>();
      function noteDrop(title: string, reason: string): void {
        const key = `${title.trim().toLowerCase()}`;
        if (!dropSeen.has(key)) {
          dropSeen.add(key);
          console.log("[generate/stream] dropped", { title, reason });
        }
      }
      function passesHardChecks(
        q: ClaudeQuest,
        siblingTitles: string[],
      ): boolean {
        if (!isSafe(q)) return false;
        const haystack = `${q.title} ${q.description}`;
        if (isNearDuplicate(q.title, previousTitles, siblingTitles)) {
          noteDrop(q.title, "duplicate");
          return false;
        }
        if (walkingOnly && requiresCar(haystack)) {
          noteDrop(q.title, "car_required");
          return false;
        }
        if (freeOnly && requiresSpend(haystack)) {
          noteDrop(q.title, "paid_activity");
          return false;
        }
        return true;
      }

      // Progressive path: every completed object joins the candidate pool;
      // ONLY the first hard-check-passing quest is emitted immediately (the
      // ranked remainder ships at end of stream).
      const scanned: ClaudeQuest[] = [];
      function consider(raw: string): void {
        let q: ClaudeQuest;
        try {
          q = JSON.parse(raw) as ClaudeQuest;
        } catch {
          return;
        }
        scanned.push(q);
        if (emitted.length === 0 && passesHardChecks(q, [])) emit(q);
      }

      try {
        const llm = client.messages.stream(
          {
            model: "claude-haiku-4-5",
            // 6 candidates fit in ~450-550 output tokens with the slim 3-key
            // schema; 1000 gives headroom so the final object always closes
            // before the model stops (a tight ceiling truncates mid-object,
            // costing parseable candidates). max_tokens is a ceiling, not a
            // target — normal latency is unchanged.
            max_tokens: 1000,
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

        // Progressive scanning: every completed object joins the candidate
        // pool (also the parse-failure fallback), and the first passing quest
        // is emitted immediately for time-to-first-card. Reliability of the
        // FINAL batch does NOT depend on this — see the authoritative
        // reconcile below. Using .on("text") (SDK-accumulated deltas) instead
        // of raw-event iteration avoids any event-shape/tail edge cases.
        let buf = "";
        const scan = makeScanState();
        llm.on("text", (delta: string) => {
          buf += delta;
          for (const obj of scanObjects(buf, scan)) {
            consider(obj);
          }
        });

        // Authoritative reconcile: finalMessage() is the COMPLETE response.
        // Parse the full array (falling back to the progressively scanned
        // objects), exclude the already-emitted first card, hard-filter the
        // rest, and RANK the remaining slots — highest mechanical score with
        // category-spread bonus, final slot reserved for the exploration
        // pick outside the user's vibes.
        const finalMsg = await llm.finalMessage();
        clearTimeout(timer);
        const stopReason = finalMsg.stop_reason ?? null;
        const tb = finalMsg.content.find((b) => b.type === "text");
        const fullText = tb && tb.type === "text" ? tb.text : buf;

        let parsedLen = 0;
        let rankedPool = 0;
        if (emitted.length < TARGET_COUNT) {
          let candidates: ClaudeQuest[] = scanned;
          let parsed: unknown = null;
          try {
            parsed = extractJsonArray(fullText);
          } catch {
            parsed = null;
          }
          if (Array.isArray(parsed)) {
            parsedLen = parsed.length;
            candidates = (parsed as ClaudeQuest[]).slice(0, BATCH_COUNT);
          }

          // The progressive pass emitted the FIRST passing candidate, so the
          // first title match in model order is that quest — skip exactly it.
          const emittedTitles = emitted.map((e) => e.title);
          const rest: ClaudeQuest[] = [];
          let skippedEmitted = emitted.length === 0;
          for (const q of candidates) {
            if (
              !skippedEmitted &&
              typeof q?.title === "string" &&
              q.title.trim() === emittedTitles[0]
            ) {
              skippedEmitted = true;
              continue;
            }
            rest.push(q);
          }
          // isSafe scrubs progressively-seen instances, but the full-parse
          // candidates are fresh objects — scrub before filtering/ranking.
          scrub(rest, places);
          const filtered = hardFilterQuests(rest, {
            previousTitles,
            alreadyKeptTitles: emittedTitles,
            walkingOnly,
            freeOnly,
            hooks: { findSafetyViolation, isNearDuplicate },
          });
          for (const d of filtered.dropped) noteDrop(d.title, d.reason);
          rankedPool = filtered.kept.length;
          const ranked = selectTopQuests(filtered.kept, {
            target: TARGET_COUNT - emitted.length,
            preferredCategories: preferredV4Categories(vibes),
            isFood: (q) => isFoodQuest(q as ClaudeQuest),
            allowFoodHeavy:
              (requestedCategory ?? "").toLowerCase() === "food",
            foodAlreadyPicked: emitted.some((e) =>
              isFoodQuest({
                title: e.title,
                description: e.description,
                category: e.category,
              } as ClaudeQuest),
            ),
          });
          for (const q of ranked) emit(q);
        }

        // Guarantee 3: if we're still short — the model produced fewer than
        // requested, or hard drops thinned the pool — fill the gap with one
        // top-up generation. Fires at most once; the first card has already
        // streamed, so perceived latency is unaffected.
        let topupMs = 0;
        if (emitted.length < TARGET_COUNT) {
          const need = TARGET_COUNT - emitted.length;
          const tStart = Date.now();
          // Fresh abort — the route's 25s timer was cleared right after
          // finalMessage, so the old code passed an already-inert signal
          // here and the top-up ran with no timeout at all.
          const topupAbort = new AbortController();
          const topupTimer = setTimeout(() => topupAbort.abort(), 10_000);
          try {
            // Full request context via the shared builder — the old
            // hand-rolled prompt carried only region + spice, discarding the
            // requested category, banned titles, group size, and the
            // walking/cost constraints, and ran hot at temperature 0.9 (the
            // main call is pinned at 0.75 precisely because higher
            // temperatures bias toward JSON schema drift). Emitted titles
            // join the blocklist so the refill can't duplicate this batch.
            const { userMessage: topupMessage } = buildUserMessage({
              region,
              spiceLevel,
              groupSize,
              timeAvailable,
              requestedCategory,
              canDrive,
              costPref,
              vibes,
              localTime,
              typeCounts,
              previousTitles: sanitizePreviousTitles([
                ...previousTitles,
                ...emitted.map((e) => e.title),
              ]),
              count: need,
            });
            const topup = await client.messages.create(
              {
                model: "claude-haiku-4-5",
                max_tokens: 120 + 200 * need,
                temperature: 0.75,
                system: [
                  {
                    type: "text",
                    text: SYSTEM_PROMPT,
                    cache_control: { type: "ephemeral", ttl: "1h" },
                  },
                ],
                messages: [{ role: "user", content: topupMessage }],
              },
              { signal: topupAbort.signal },
            );
            topupMs = Date.now() - tStart;
            const tub = topup.content.find((b) => b.type === "text");
            const tutext = tub && tub.type === "text" ? tub.text : "";
            let tup: unknown = null;
            try {
              tup = extractJsonArray(tutext);
            } catch {
              tup = null;
            }
            if (Array.isArray(tup)) {
              const refill = (tup as ClaudeQuest[]).slice(0, need + 1);
              scrub(refill, places);
              for (const item of refill) {
                if (emitted.length >= TARGET_COUNT) break;
                if (
                  passesHardChecks(
                    item,
                    emitted.map((e) => e.title),
                  )
                ) {
                  emit(item);
                }
              }
            }
          } catch (e) {
            console.log("[generate/stream] topup failed", e);
          } finally {
            clearTimeout(topupTimer);
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
          rankedPool,
          stopReason,
          heldCount,
          dropped: dropSeen.size,
          topupMs,
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
          // Held quests for owner review (rule + matched text + full quest).
          // A high held rate here flags an over-aggressive rule or a model
          // genuinely emitting unsafe content — worth periodic review.
          held,
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
              // Diagnostics surfaced in the stream so they're readable client-
              // side (server logs aren't): parsedLen = objects in the complete
              // message; heldCount = quests dropped for safety; dropped = all
              // hard drops (safety + dup + constraint); stopReason from the
              // model; topupMs > 0 means the fill-to-3 call fired.
              parsedLen,
              rankedPool,
              heldCount,
              dropped: dropSeen.size,
              stopReason,
              topupMs,
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
