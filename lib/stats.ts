import type { Quest, QuestEvent } from "@/lib/database.types";

const HOUR_MS = 60 * 60 * 1000;
const MAX_QUEST_HOURS_MS = 6 * HOUR_MS;

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBetween(aDay: string, bDay: string): number {
  const [ay, am, ad] = aDay.split("-").map(Number);
  const [by, bm, bd] = bDay.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((tb - ta) / 86400000);
}

function todayUtc(now: Date = new Date()): string {
  return utcDay(now);
}

function yesterdayUtc(now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - 1,
    ),
  );
  return utcDay(d);
}

export type StreakResult = {
  current: number;
  longest: number;
  lastCompletedAt: Date | null;
};

/**
 * Streak rules (spec):
 *   - A UTC day with ≥1 completion counts.
 *   - Current streak = consecutive trailing days through today OR yesterday
 *     (no completion today yet is still "current" until midnight UTC of the
 *     next day).
 *   - Longest streak = longest consecutive run ever.
 *   - No grace day.
 */
export function computeStreaks(
  completedEvents: Pick<QuestEvent, "created_at">[],
  now: Date = new Date(),
): StreakResult {
  if (completedEvents.length === 0) {
    return { current: 0, longest: 0, lastCompletedAt: null };
  }

  const dayset = new Set<string>();
  let lastTs = 0;
  for (const e of completedEvents) {
    const d = new Date(e.created_at);
    dayset.add(utcDay(d));
    if (d.getTime() > lastTs) lastTs = d.getTime();
  }
  const lastCompletedAt = new Date(lastTs);

  const sorted = Array.from(dayset).sort();

  // Longest run.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1], sorted[i]);
    if (gap === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak.
  const today = todayUtc(now);
  const yesterday = yesterdayUtc(now);
  const tail = sorted[sorted.length - 1];
  let current = 0;
  if (tail === today || tail === yesterday) {
    current = 1;
    let prev = tail;
    for (let i = sorted.length - 2; i >= 0; i--) {
      const gap = daysBetween(sorted[i], prev);
      if (gap === 1) {
        current += 1;
        prev = sorted[i];
      } else {
        break;
      }
    }
  }

  return { current, longest, lastCompletedAt };
}

export type TotalsResult = {
  count: number;
  hoursSpent: number;
};

/**
 * Totals rules (spec):
 *   - count = number of distinct quests with at least one completed event.
 *   - hoursSpent = sum across those quests of
 *       (first_completed_at - first_started_at), clamped to [0, 6h].
 *   - Out-of-range deltas (paused / abandoned timelines) clamp to 6h so they
 *     don't skew the total.
 */
export function computeTotals(
  quests: Pick<Quest, "id">[],
  events: Pick<QuestEvent, "quest_id" | "event_type" | "created_at">[],
): TotalsResult {
  const byQuest = new Map<string, Pick<QuestEvent, "event_type" | "created_at">[]>();
  for (const e of events) {
    const arr = byQuest.get(e.quest_id);
    if (arr) arr.push(e);
    else byQuest.set(e.quest_id, [e]);
  }

  let count = 0;
  let totalMs = 0;
  for (const q of quests) {
    const es = byQuest.get(q.id);
    if (!es) continue;
    const firstStarted = es
      .filter((e) => e.event_type === "started")
      .map((e) => new Date(e.created_at).getTime())
      .sort((a, b) => a - b)[0];
    const firstCompleted = es
      .filter((e) => e.event_type === "completed")
      .map((e) => new Date(e.created_at).getTime())
      .sort((a, b) => a - b)[0];
    if (firstCompleted === undefined) continue;
    count += 1;
    if (firstStarted === undefined) continue;
    const raw = firstCompleted - firstStarted;
    const clamped = Math.max(0, Math.min(MAX_QUEST_HOURS_MS, raw));
    totalMs += clamped;
  }

  return { count, hoursSpent: totalMs / HOUR_MS };
}

/**
 * Returns the last N UTC days ending today (inclusive), oldest first, marking
 * whether each had a completion. Used by the StreakRing to render the
 * trailing-7 visual.
 */
export function trailingDayCompletions(
  completedEvents: Pick<QuestEvent, "created_at">[],
  span = 7,
  now: Date = new Date(),
): { day: string; completed: boolean }[] {
  const dayset = new Set<string>();
  for (const e of completedEvents) {
    dayset.add(utcDay(new Date(e.created_at)));
  }

  const out: { day: string; completed: boolean }[] = [];
  for (let offset = span - 1; offset >= 0; offset--) {
    const d = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() - offset,
      ),
    );
    const key = utcDay(d);
    out.push({ day: key, completed: dayset.has(key) });
  }
  return out;
}
