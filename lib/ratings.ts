export type Rating = "cooked" | "mid" | "tuff" | "fire";

export type RatingRecord = {
  questId: string;
  questName: string;
  category: string;
  spiceLevel: number;
  groupSize: number;
  timeAvailable: number;
  rating: Rating;
  timestamp: number;
};

export const RATING_STORAGE_KEY = "sqRatings";

export function ratingScoreDelta(rating: Rating | undefined): number {
  switch (rating) {
    case "fire":
      return 5;
    case "tuff":
      return 2;
    case "mid":
      return -1;
    case "cooked":
      return -10; // effectively excluded by the viability filter
    default:
      return 0;
  }
}

export function latestRatings(records: RatingRecord[]): Record<string, Rating> {
  const out: Record<string, { rating: Rating; ts: number }> = {};
  for (const r of records) {
    const prev = out[r.questId];
    if (!prev || r.timestamp > prev.ts) {
      out[r.questId] = { rating: r.rating, ts: r.timestamp };
    }
  }
  const flat: Record<string, Rating> = {};
  for (const [k, v] of Object.entries(out)) flat[k] = v.rating;
  return flat;
}
