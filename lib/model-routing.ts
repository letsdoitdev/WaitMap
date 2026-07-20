/**
 * Model routing for quest generation (M13 phase 5) — spend where users
 * feel it. The first roll of a session is the impression-forming one (and
 * the one Pro users pay for), so it routes to a stronger model; rerolls
 * stay on the fast/cheap model.
 *
 * Env-configurable, all optional:
 * - MODEL_FIRST_ROLL  — model for first rolls + Pro users (default claude-sonnet-4-6)
 * - MODEL_REROLL      — model for rerolls (default claude-haiku-4-5)
 * - MODEL_FORCE_HAIKU — kill switch: "1" forces claude-haiku-4-5 everywhere,
 *                       ignoring the other two vars.
 *
 * Note for operators: the Anthropic prompt cache is PER-MODEL, so each model
 * warms its own copy of the system prompt — after enabling, confirm BOTH
 * models show cacheRead > 0 in the [generate] cache logs. The cached prefix
 * clears both minimums (Sonnet: 1024 tokens, Haiku 4.5: 4096).
 */

export const HAIKU_MODEL = "claude-haiku-4-5";
const DEFAULT_FIRST_ROLL_MODEL = "claude-sonnet-4-6";

export type ModelRouteReason =
  | "kill_switch"
  | "pro_tier"
  | "first_roll"
  | "reroll";

export type ModelRoute = { model: string; reason: ModelRouteReason };

export function pickModel(opts: {
  /** True when the request carries no previousTitles — the client's ring
   * buffer and session memory are both empty, i.e. a fresh session. */
  isFirstRoll: boolean;
  /** Server-verified Pro tier (never a client flag). */
  isPro: boolean;
}): ModelRoute {
  if (process.env.MODEL_FORCE_HAIKU === "1") {
    return { model: HAIKU_MODEL, reason: "kill_switch" };
  }
  const firstRollModel =
    process.env.MODEL_FIRST_ROLL || DEFAULT_FIRST_ROLL_MODEL;
  if (opts.isPro) return { model: firstRollModel, reason: "pro_tier" };
  if (opts.isFirstRoll) return { model: firstRollModel, reason: "first_roll" };
  return { model: process.env.MODEL_REROLL || HAIKU_MODEL, reason: "reroll" };
}
