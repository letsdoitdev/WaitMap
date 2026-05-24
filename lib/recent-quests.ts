/**
 * Persistent ring buffer of the last N quest IDs the user was shown.
 *
 * Lives in localStorage (key `sqRecentQuestsV1`) so it survives both reload
 * AND tab close — the bug it solves is rerolls (or category switches)
 * surfacing identical quests because the caller wasn't threading
 * already-seen IDs across those calls.
 *
 * Pure caller-side fix per the M8.3.1 spec — `lib/generate.ts` already
 * accepts `excludeIds`, we just need to feed it a longer-lived list. No
 * changes to weights, the ratings 'cooked' system, or anything inside
 * generate.ts.
 */

export const RECENT_QUESTS_KEY = "sqRecentQuestsV1";
export const RECENT_QUESTS_CAP = 30;

export function loadRecentQuestIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_QUESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Appends the given IDs (deduped against each other and against the
 * existing buffer), keeping the buffer at most RECENT_QUESTS_CAP long.
 * Most-recent IDs are at the tail; the oldest entries fall off the head.
 * Returns the updated buffer.
 */
export function appendRecentQuestIds(ids: string[]): string[] {
  if (typeof window === "undefined") return ids.slice(-RECENT_QUESTS_CAP);
  const incoming = ids.filter((x): x is string => typeof x === "string");
  if (incoming.length === 0) return loadRecentQuestIds();

  const existing = loadRecentQuestIds();
  // Drop any prior occurrences of the incoming ids so we preserve recency.
  const incomingSet = new Set(incoming);
  const trimmed = existing.filter((id) => !incomingSet.has(id));
  const next = [...trimmed, ...incoming].slice(-RECENT_QUESTS_CAP);
  try {
    window.localStorage.setItem(RECENT_QUESTS_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / privacy mode
  }
  return next;
}

/** Test / QA escape hatch — wipe the ring buffer. */
export function clearRecentQuestIds(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_QUESTS_KEY);
  } catch {
    // ignore
  }
}
