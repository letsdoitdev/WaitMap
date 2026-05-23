import type { QuestEvent, QuestEventType } from "@/lib/database.types";

export type QuestState =
  | "generated"
  | "active"
  | "paused"
  | "completed"
  | "abandoned";

/**
 * Latest event in time order wins. With no events the quest is still
 * just "generated" (e.g. we never wrote a started row, or this is a
 * client-only quest that hasn't been started yet).
 */
export function getQuestState(
  events: Pick<QuestEvent, "event_type" | "created_at">[],
): QuestState {
  if (!events.length) return "generated";
  const sorted = [...events].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const latest = sorted[0].event_type;
  switch (latest) {
    case "started":
    case "resumed":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "abandoned":
      return "abandoned";
    default:
      return "generated";
  }
}

/**
 * Sum of (resume → next-pause-or-now) intervals. The source of truth for
 * elapsed time. Pass a server-provided `now` to avoid client clock drift.
 */
export function computeElapsedMs(
  events: Pick<QuestEvent, "event_type" | "created_at">[],
  nowIso: string,
): number {
  if (!events.length) return 0;
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const now = new Date(nowIso).getTime();
  let elapsed = 0;
  let runStart: number | null = null;

  for (const e of sorted) {
    const t = new Date(e.created_at).getTime();
    if (e.event_type === "started" || e.event_type === "resumed") {
      if (runStart === null) runStart = t;
    } else if (
      e.event_type === "paused" ||
      e.event_type === "completed" ||
      e.event_type === "abandoned"
    ) {
      if (runStart !== null) {
        elapsed += Math.max(0, t - runStart);
        runStart = null;
      }
    }
  }

  // Quest is still running — accumulate from last run-start to `now`.
  if (runStart !== null) {
    elapsed += Math.max(0, now - runStart);
  }

  return elapsed;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function isRunningState(state: QuestState): boolean {
  return state === "active";
}

export function isLiveState(state: QuestState): boolean {
  return state === "active" || state === "paused";
}

export const ACTIVE_EVENT_TYPES: QuestEventType[] = [
  "started",
  "resumed",
  "paused",
];
