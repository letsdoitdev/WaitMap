import { QUESTS, QuestTemplate } from "./quests";

export type GenerateInput = {
  city: string;
  groupSize: number;
  timeMinutes: number;
  spice: number; // 1-10
};

export type GeneratedQuest = QuestTemplate & {
  title: string;
  description: string;
};

const SPICE_TOLERANCE = 3;

export function generateQuests(input: GenerateInput, count = 4): GeneratedQuest[] {
  const city = input.city.trim() || "your city";

  const scored = QUESTS.map((q) => {
    const groupOk = input.groupSize >= q.minGroup && input.groupSize <= q.maxGroup;
    const timeOk = input.timeMinutes >= q.minTime;
    const spiceGap = Math.abs(q.spice - input.spice);
    const spiceOk = spiceGap <= SPICE_TOLERANCE;

    let score = 0;
    if (groupOk) score += 3;
    if (timeOk) score += 3;
    score += Math.max(0, SPICE_TOLERANCE - spiceGap);
    // light bonus for time being a comfortable fit (not way over)
    if (timeOk && input.timeMinutes <= q.maxTime + 60) score += 1;

    return { q, score, groupOk, timeOk, spiceOk };
  });

  // Keep only minimally viable candidates first, fall back if needed.
  let pool = scored.filter((s) => s.groupOk && s.timeOk && s.spiceOk);
  if (pool.length < count) {
    pool = scored.filter((s) => s.groupOk && s.timeOk);
  }
  if (pool.length < count) {
    pool = scored.filter((s) => s.groupOk);
  }
  if (pool.length < count) pool = scored;

  // Weighted random sampling without replacement (higher score = more likely).
  const picks: typeof scored = [];
  const working = pool.slice();
  while (picks.length < count && working.length > 0) {
    const totalWeight = working.reduce((sum, s) => sum + Math.max(1, s.score) ** 1.5, 0);
    let r = Math.random() * totalWeight;
    let idx = 0;
    for (let i = 0; i < working.length; i++) {
      r -= Math.max(1, working[i].score) ** 1.5;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picks.push(working[idx]);
    working.splice(idx, 1);
  }

  return picks.map(({ q }) => ({
    ...q,
    title: q.title.replaceAll("{city}", city),
    description: q.description.replaceAll("{city}", city),
  }));
}
