export type QuestCategory =
  | "Chaos"
  | "Outdoor"
  | "Social"
  | "Creative"
  | "Food"
  | "Late Night"
  | "Chill"
  | "Fitness"
  | "Nature"
  | "Tech"
  | "Exploration"
  | "Indoor";

export type QuestCost = "free" | "$" | "$$" | "$$$";

export type QuestTemplate = {
  id: string;
  title: string;
  description: string;
  category: QuestCategory;
  spice: number; // 1-10
  minGroup: number;
  maxGroup: number;
  minTime: number; // minutes
  maxTime: number;
  cost?: QuestCost;
  lateNight?: boolean;
  // OSM tag values to look for if we have nearby-place data. If a match is
  // found, {venue} in title/description is replaced with the real venue name.
  venueQuery?: string[];
};

// Template library deleted — generation is now AI-only via /api/generate.
// The array is kept as an empty export so callers that still import QUESTS
// for type narrowing or telemetry don't need to change.
export const QUESTS: QuestTemplate[] = [];
