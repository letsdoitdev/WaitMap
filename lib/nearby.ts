export type NearbyCategory =
  | "food"
  | "nightlife"
  | "shop"
  | "leisure"
  | "culture"
  | "fitness";

export type NearbyBucket =
  | "food"
  | "nature"
  | "culture"
  | "utility"
  | "chill"
  | "other";

export type NearbyPlace = {
  name: string;
  /** Raw OSM tag value, e.g. "park", "museum", "restaurant". */
  type: string;
  category: NearbyCategory;
  /** Primary balance bucket used for per-category quotas. */
  bucket: NearbyBucket;
};

export type NearbyResponse = {
  ok: boolean;
  location?: { display: string; lat: number; lon: number };
  places: NearbyPlace[];
  /** Count of places by balance bucket after capping/shuffling. */
  categoryCounts?: Partial<Record<NearbyBucket, number>>;
  /** Count of places by raw OSM type after capping (e.g. {restaurant:3, park:2}). */
  typeCounts?: Record<string, number>;
  error?: string;
};

const TYPE_TO_CATEGORY: Record<string, NearbyCategory> = {
  restaurant: "food",
  fast_food: "food",
  cafe: "food",
  bar: "nightlife",
  cinema: "culture",
  theatre: "culture",
  gym: "fitness",
  library: "culture",
  hardware: "shop",
  supermarket: "shop",
  mall: "shop",
  park: "leisure",
  playground: "leisure",
  sports_centre: "fitness",
  stadium: "leisure",
  attraction: "culture",
  museum: "culture",
  viewpoint: "culture",
};

export function categoryOf(osmType: string): NearbyCategory {
  return TYPE_TO_CATEGORY[osmType] ?? "leisure";
}

/**
 * Assign each OSM type to one primary balance bucket. Priority order is
 * encoded by the if-chain so overlapping definitions (e.g. library counts
 * for both culture and chill) resolve deterministically: chill claims
 * library + playground first, then nature/culture/utility/other.
 */
export function bucketOf(osmType: string): NearbyBucket {
  if (
    osmType === "fast_food" ||
    osmType === "restaurant" ||
    osmType === "cafe" ||
    osmType === "bar"
  ) {
    return "food";
  }
  if (osmType === "library" || osmType === "playground") return "chill";
  if (
    osmType === "park" ||
    osmType === "sports_centre" ||
    osmType === "stadium" ||
    osmType === "viewpoint"
  ) {
    return "nature";
  }
  if (
    osmType === "attraction" ||
    osmType === "museum" ||
    osmType === "cinema" ||
    osmType === "theatre"
  ) {
    return "culture";
  }
  if (osmType === "supermarket" || osmType === "mall" || osmType === "hardware") {
    return "utility";
  }
  return "other";
}

/** Per-bucket hard caps used by the rebalance pipeline in /api/nearby-places. */
export const BUCKET_CAPS: Record<NearbyBucket, number> = {
  food: 4,
  nature: 4,
  culture: 4,
  utility: 3,
  chill: 2,
  other: 20,
};

/** Pick a random nearby place matching one of the requested OSM types. */
export function pickVenue(
  places: NearbyPlace[],
  wanted: string[] | undefined,
): NearbyPlace | null {
  if (!wanted || wanted.length === 0 || places.length === 0) return null;
  const wantedSet = new Set(wanted);
  const matches = places.filter((p) => wantedSet.has(p.type));
  if (matches.length === 0) return null;
  return matches[Math.floor(Math.random() * matches.length)];
}

/** Fisher–Yates in-place shuffle (returns a new array). */
export function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
