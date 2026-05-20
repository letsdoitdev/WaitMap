import { QUESTS, QuestTemplate } from "./quests";
import { NearbyPlace, pickVenue } from "./nearby";
import { Rating, ratingScoreDelta } from "./ratings";

export type GenerateInput = {
  city: string;
  groupSize: number;
  timeMinutes: number;
  spice: number; // 1-10
  nearby?: NearbyPlace[];
  ratings?: Record<string, Rating>;
};

export type GeneratedQuest = QuestTemplate & {
  title: string;
  description: string;
  nearbyDetected: boolean;
  matchedVenue?: { name: string; type: string };
};

const SPICE_TOLERANCE = 3;

export function generateQuests(input: GenerateInput, count = 4): GeneratedQuest[] {
  const city = input.city.trim() || "your city";
  const nearby = input.nearby ?? [];
  const ratings = input.ratings ?? {};

  const scored = QUESTS.map((q) => {
    const groupOk = input.groupSize >= q.minGroup && input.groupSize <= q.maxGroup;
    const timeOk = input.timeMinutes >= q.minTime;
    const spiceGap = Math.abs(q.spice - input.spice);
    const spiceOk = spiceGap <= SPICE_TOLERANCE;

    let score = 0;
    if (groupOk) score += 3;
    if (timeOk) score += 3;
    score += Math.max(0, SPICE_TOLERANCE - spiceGap);
    if (timeOk && input.timeMinutes <= q.maxTime + 60) score += 1;

    // Boost quests where we can plug in a real nearby venue.
    if (q.venueQuery && pickVenue(nearby, q.venueQuery)) {
      score += 2;
    }

    score += ratingScoreDelta(ratings[q.id]);

    return { q, score, groupOk, timeOk, spiceOk, cooked: ratings[q.id] === "cooked" };
  });

  // Filter viable + drop user's "cooked" choices entirely when possible.
  let pool = scored.filter((s) => s.groupOk && s.timeOk && s.spiceOk && !s.cooked);
  if (pool.length < count) pool = scored.filter((s) => s.groupOk && s.timeOk && !s.cooked);
  if (pool.length < count) pool = scored.filter((s) => s.groupOk && !s.cooked);
  if (pool.length < count) pool = scored.filter((s) => !s.cooked);
  if (pool.length < count) pool = scored;

  const picks: typeof scored = [];
  const working = pool.slice();
  while (picks.length < count && working.length > 0) {
    const totalWeight = working.reduce(
      (sum, s) => sum + Math.max(1, s.score) ** 1.5,
      0,
    );
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

  return picks.map(({ q }) => {
    const venue = pickVenue(nearby, q.venueQuery);
    const venueName = venue?.name ?? "a spot you choose";
    return {
      ...q,
      title: q.title.replaceAll("{city}", city).replaceAll("{venue}", venueName),
      description: q.description
        .replaceAll("{city}", city)
        .replaceAll("{venue}", venueName),
      nearbyDetected: Boolean(venue),
      matchedVenue: venue ? { name: venue.name, type: venue.type } : undefined,
    };
  });
}
