/**
 * Cross-cutting constants. Keep this file small and dependency-free so
 * components and the analytics layer can import it without dragging in the
 * Supabase client or React.
 */

/**
 * TODO — swap to the real App Store listing URL once we ship to TestFlight
 * / App Store. Today it points at the generic store landing so the "Leave
 * a review" tap goes somewhere sensible during preview.
 */
export const APP_STORE_REVIEW_URL = "https://apps.apple.com/";

/** localStorage key the review-prompt path uses to ensure one-shot firing. */
export const REVIEW_PROMPT_STORAGE_KEY = "unemployment.review_prompted.v1";

/** Daily reroll cap for free-tier users (M12.1). Pro is uncapped. */
export const FREE_DAILY_REROLLS = 5;

/**
 * UTC date key ("YYYY-MM-DD") used to bucket per-day reroll counts. UTC so the
 * client banner and the server gate agree regardless of the user's timezone.
 */
export function getUtcDateKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
