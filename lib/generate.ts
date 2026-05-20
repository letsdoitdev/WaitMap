import { QUESTS, QuestTemplate } from "./quests";
import { NearbyPlace, pickVenue } from "./nearby";
import { Rating } from "./ratings";

export type GenerateInput = {
  city: string;
  groupSize: number;
  timeMinutes: number;
  spice: number; // 1-10
  nearby?: NearbyPlace[];
  ratings?: Record<string, Rating>;
  excludeIds?: string[]; // quest ids already shown this session
};

export type GenerateResult = {
  quests: GeneratedQuest[];
  resetShown: boolean; // true if we ran out of fresh quests and reset
};

export type GeneratedQuest = QuestTemplate & {
  title: string;
  description: string;
  nearbyDetected: boolean;
  matchedVenue?: { name: string; type: string };
};

const SPICE_TOLERANCE = 3;

function fisherYates<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function viable(q: QuestTemplate, input: GenerateInput): boolean {
  if (input.groupSize < q.minGroup || input.groupSize > q.maxGroup) return false;
  if (input.timeMinutes < q.minTime) return false;
  if (Math.abs(q.spice - input.spice) > SPICE_TOLERANCE) return false;
  return true;
}

export function generateQuests(
  input: GenerateInput,
  count = 4,
): GenerateResult {
  const city = input.city.trim() || "your city";
  const nearby = input.nearby ?? [];
  const ratings = input.ratings ?? {};
  const excluded = new Set(input.excludeIds ?? []);

  // 1. Filter for viability + drop cooked-rated quests.
  const fullViable = QUESTS.filter(
    (q) => viable(q, input) && ratings[q.id] !== "cooked",
  );

  // 2. Within viable, prefer never-shown quests; if empty, reset.
  let fresh = fullViable.filter((q) => !excluded.has(q.id));
  let resetShown = false;
  if (fresh.length < count) {
    resetShown = true;
    fresh = fullViable;
  }

  // 3. If still under-count, relax constraints progressively (preserving the
  //    reset signal so the UI knows we wrapped around).
  let pool: QuestTemplate[] = fresh;
  if (pool.length < count) {
    pool = QUESTS.filter(
      (q) =>
        input.groupSize >= q.minGroup &&
        input.groupSize <= q.maxGroup &&
        input.timeMinutes >= q.minTime &&
        ratings[q.id] !== "cooked",
    );
    resetShown = true;
  }
  if (pool.length < count) {
    pool = QUESTS.filter(
      (q) =>
        input.groupSize >= q.minGroup &&
        input.groupSize <= q.maxGroup &&
        ratings[q.id] !== "cooked",
    );
    resetShown = true;
  }
  if (pool.length < count) {
    pool = QUESTS.filter((q) => ratings[q.id] !== "cooked");
    resetShown = true;
  }
  if (pool.length < count) pool = QUESTS.slice();

  // 4. Fisher-Yates shuffle, take first N.
  const shuffled = fisherYates(pool);
  const picked = shuffled.slice(0, count);

  // 5. Resolve venues + templating.
  const quests = picked.map((q): GeneratedQuest => {
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

  return { quests, resetShown };
}
