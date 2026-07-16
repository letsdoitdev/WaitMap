/**
 * Persistent ring buffer of the last N quests (id + title) the user was
 * shown.
 *
 * Lives in localStorage (key `sqRecentQuestsV2`) so it survives both reload
 * AND tab close — the bug it solves is rerolls (or category switches)
 * surfacing identical quests because the caller wasn't threading
 * already-seen quests across those calls.
 *
 * V1 stored bare quest IDs, but server-side IDs are random-suffixed slugs
 * that never collide — 30 slots of cross-session memory that did nothing for
 * content dedup. V2 stores {id, title} pairs: the TITLES feed the server's
 * BANNED TITLES blocklist (the signal its similarity checks actually use),
 * while the ids keep feeding excludeIds. The V1 key is dropped on first
 * write; its random-ID contents had no content-dedup value to migrate.
 */

export const RECENT_QUESTS_KEY = "sqRecentQuestsV2";
const LEGACY_V1_KEY = "sqRecentQuestsV1";
export const RECENT_QUESTS_CAP = 30;

export type RecentQuest = { id: string; title: string };

function isRecentQuest(x: unknown): x is RecentQuest {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as RecentQuest).id === "string" &&
    typeof (x as RecentQuest).title === "string"
  );
}

export function loadRecentQuests(): RecentQuest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_QUESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentQuest);
  } catch {
    return [];
  }
}

/**
 * Appends the given quests (deduped by normalized title against each other
 * and against the existing buffer), keeping the buffer at most
 * RECENT_QUESTS_CAP long. Most-recent entries are at the tail; the oldest
 * fall off the head. Returns the updated buffer.
 */
export function appendRecentQuests(entries: RecentQuest[]): RecentQuest[] {
  if (typeof window === "undefined") return entries.slice(-RECENT_QUESTS_CAP);
  const incoming = entries.filter(isRecentQuest);
  if (incoming.length === 0) return loadRecentQuests();

  const titleKey = (q: RecentQuest) => q.title.trim().toLowerCase();
  const existing = loadRecentQuests();
  // Drop prior occurrences of the incoming titles so we preserve recency,
  // then dedupe the incoming batch against itself.
  const incomingKeys = new Set(incoming.map(titleKey));
  const trimmed = existing.filter((q) => !incomingKeys.has(titleKey(q)));
  const seen = new Set<string>();
  const dedupedIncoming = incoming.filter((q) => {
    const k = titleKey(q);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const next = [...trimmed, ...dedupedIncoming].slice(-RECENT_QUESTS_CAP);
  try {
    window.localStorage.setItem(RECENT_QUESTS_KEY, JSON.stringify(next));
    window.localStorage.removeItem(LEGACY_V1_KEY);
  } catch {
    // ignore quota / privacy mode
  }
  return next;
}

/**
 * True if either buffer generation has entries. Used by the onboarding
 * backfill check ("has this user clearly used the app before?") so users
 * with only legacy V1 data aren't bounced through the quiz again.
 */
export function hasAnyRecentQuests(): boolean {
  if (typeof window === "undefined") return false;
  if (loadRecentQuests().length > 0) return true;
  try {
    const raw = window.localStorage.getItem(LEGACY_V1_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/** Test / QA escape hatch — wipe the ring buffer (both key generations). */
export function clearRecentQuests(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_QUESTS_KEY);
    window.localStorage.removeItem(LEGACY_V1_KEY);
  } catch {
    // ignore
  }
}
