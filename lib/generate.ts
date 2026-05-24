import { QUESTS, QuestTemplate } from "./quests";
import { NearbyPlace, pickVenue } from "./nearby";
import { Rating } from "./ratings";

/**
 * Map an OSM type to a generic, non-identifying placeholder. We deliberately
 * never substitute the real venue name into a quest title/description.
 */
function placeholderForType(osmType: string | undefined): string {
  if (!osmType) return "a nearby spot";
  if (["fast_food", "restaurant", "cafe", "bar"].includes(osmType))
    return "a nearby spot";
  if (osmType === "park") return "a nearby park";
  if (osmType === "playground") return "a local playground";
  if (osmType === "sports_centre") return "a nearby sports centre";
  if (osmType === "stadium") return "a nearby stadium";
  if (osmType === "viewpoint") return "a nearby viewpoint";
  if (osmType === "museum") return "a local museum";
  if (osmType === "attraction") return "a nearby attraction";
  if (osmType === "cinema") return "a local cinema";
  if (osmType === "theatre") return "a local theatre";
  if (osmType === "library") return "a local library";
  if (osmType === "gym") return "a nearby gym";
  if (["supermarket", "mall"].includes(osmType)) return "a nearby store";
  if (osmType === "hardware") return "a hardware store";
  return "a nearby spot";
}

export type OnboardingPrefs = {
  vibe_categories?: string[];
  cost_pref?: "free" | "cheap" | "any";
};

export type GenerateInput = {
  city: string;
  groupSize: number;
  timeMinutes: number;
  spice: number; // 1-10
  nearby?: NearbyPlace[];
  ratings?: Record<string, Rating>;
  excludeIds?: string[]; // quest ids already shown this session
  onboardingPrefs?: OnboardingPrefs;
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

/**
 * Soft bias from the onboarding answers. We never hard-filter — variety is
 * the point — but vibe matches get +25% weight (per spec), and cost_pref
 * tilts the cost ladder in the user's direction. With no prefs every weight
 * is 1, so the picker degrades cleanly to uniform random.
 */
function templateWeight(
  q: QuestTemplate,
  prefs: OnboardingPrefs | undefined,
): number {
  let w = 1;
  if (!prefs) return w;
  if (prefs.vibe_categories && prefs.vibe_categories.length > 0) {
    if (prefs.vibe_categories.includes(q.category)) w *= 1.25;
  }
  if (prefs.cost_pref === "free") {
    if (q.cost === "free") w *= 1.4;
    else if (q.cost === "$") w *= 0.8;
    else if (q.cost === "$$") w *= 0.5;
    else if (q.cost === "$$$") w *= 0.3;
  } else if (prefs.cost_pref === "cheap") {
    if (q.cost === "free" || q.cost === "$") w *= 1.25;
    else if (q.cost === "$$") w *= 0.9;
    else if (q.cost === "$$$") w *= 0.5;
  }
  return w;
}

/**
 * Efraimidis–Spirakis weighted reservoir sampling without replacement.
 * Returns the top `count` items by exponential-rank, so heavier items are
 * more likely to land near the top without ever being guaranteed.
 */
function weightedSample<T>(
  items: T[],
  weight: (item: T) => number,
  count: number,
): T[] {
  if (items.length <= 1) return items.slice(0, count);
  const ranked = items.map((item) => {
    const w = Math.max(1e-9, weight(item));
    // Lower keys win when sorted ascending; -ln(U)/w is the standard form.
    const u = Math.random();
    const key = -Math.log(u <= 0 ? 1e-12 : u) / w;
    return { item, key };
  });
  ranked.sort((a, b) => a.key - b.key);
  return ranked.slice(0, count).map((x) => x.item);
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

  // 4. Weighted sample (no prefs → uniform; with prefs → +25% vibe, cost
  //    ladder). Falls back to a plain shuffle on the rare empty case.
  const picked = pool.length
    ? weightedSample(
        pool,
        (q) => templateWeight(q, input.onboardingPrefs),
        count,
      )
    : fisherYates(pool).slice(0, count);

  // 5. Resolve venues + templating.
  // We deliberately do NOT inject real venue names into quest text, even when
  // a nearby match exists. The quest body always renders a generic
  // category-appropriate placeholder ("a nearby park") so the offline fallback
  // honors the same venue-naming ban as the AI path. We still report
  // nearbyDetected + matchedVenue so the UI can show a chip.
  const quests = picked.map((q): GeneratedQuest => {
    const venue = pickVenue(nearby, q.venueQuery);
    const placeholder = placeholderForType(venue?.type ?? q.venueQuery?.[0]);
    return {
      ...q,
      title: q.title.replaceAll("{city}", city).replaceAll("{venue}", placeholder),
      description: q.description
        .replaceAll("{city}", city)
        .replaceAll("{venue}", placeholder),
      nearbyDetected: Boolean(venue),
      matchedVenue: venue ? { name: venue.name, type: venue.type } : undefined,
    };
  });

  return { quests, resetShown };
}
