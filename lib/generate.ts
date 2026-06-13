import { QuestTemplate } from "./quests";
import { NearbyPlace } from "./nearby";
import { Rating } from "./ratings";

// The local template-based generator was deleted as part of the AI-only
// migration. The API at /api/generate is now the single source of quests;
// callers must surface an error state on failure rather than falling back.
//
// The exported types remain so other modules can keep importing them for
// type narrowing without compile churn.

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
  resetShown: boolean;
};

export type GeneratedQuest = QuestTemplate & {
  title: string;
  description: string;
  nearbyDetected: boolean;
  matchedVenue?: { name: string; type: string };
};
