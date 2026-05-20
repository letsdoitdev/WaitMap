export type NearbyCategory =
  | "food"
  | "nightlife"
  | "shop"
  | "leisure"
  | "culture"
  | "fitness";

export type NearbyPlace = {
  name: string;
  /** Raw OSM tag value, e.g. "park", "museum", "restaurant". */
  type: string;
  category: NearbyCategory;
};

export type NearbyResponse = {
  ok: boolean;
  location?: { display: string; lat: number; lon: number };
  places: NearbyPlace[];
  error?: string;
};

const TYPE_TO_CATEGORY: Record<string, NearbyCategory> = {
  restaurant: "food",
  fast_food: "food",
  cafe: "food",
  bar: "nightlife",
  cinema: "culture",
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
