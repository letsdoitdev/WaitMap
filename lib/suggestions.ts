export type SelfRating = "cooked" | "mid" | "tuff" | "fire" | null;

export type Suggestion = {
  id: string;
  text: string;
  selfRating: SelfRating;
  timestamp: number;
};

export const SUGGEST_STORAGE_KEY = "sqSuggestions";
export const ADMIN_STATE_KEY = "sqAdminState";

export type AdminState = {
  // suggestion id -> action
  suggestionActions: Record<string, "approved" | "rejected">;
  // questId -> action (for proposed score adjustments)
  adjustmentActions: Record<string, "approved" | "rejected">;
  // suggestion id -> edited text (overrides original when present)
  suggestionEdits: Record<string, string>;
};

export const EMPTY_ADMIN_STATE: AdminState = {
  suggestionActions: {},
  adjustmentActions: {},
  suggestionEdits: {},
};
