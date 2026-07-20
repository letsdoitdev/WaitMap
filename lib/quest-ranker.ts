/**
 * Overgenerate-and-rank (M13 phase 4).
 *
 * The generator asks the model for 6 candidate quests and ships the best 3.
 * This module is the pure ranking half: hard drops first (safety, near-dup,
 * detectable constraint violations), then a mechanical score (description/
 * title length vs SKILL.md's ceilings, vibe match, food balance) and a
 * spread-aware selection where the final slot is an EXPLORATION pick — the
 * survivor least aligned with the user's stated vibes — so personalization
 * can't collapse variety.
 *
 * Everything here is pure and framework-free. Environment-specific
 * predicates (safety regexes, title similarity) are injected by the caller
 * so this stays unit-testable and the API routes remain the single owner of
 * those rule sets.
 */

export type RankableQuest = {
  title: string;
  description: string;
  category: string;
};

export type HardCheckHooks = {
  /** Route's findSafetyViolation — non-null return means hard-drop. */
  findSafetyViolation: (haystack: string) => { name: string } | null;
  /** Route's isNearDuplicate (bigram Jaccard + shared trigram). */
  isNearDuplicate: (
    title: string,
    previousTitles: string[],
    siblingTitles: string[],
  ) => boolean;
};

export type HardDropReason =
  | "shape"
  | "safety"
  | "duplicate"
  | "car_required"
  | "paid_activity";

export type HardFilterResult<Q extends RankableQuest> = {
  kept: Q[];
  dropped: Array<{ title: string; reason: HardDropReason }>;
};

// Detectable violations of explicit request constraints. Keyword-based and
// deliberately conservative: only phrasing that unambiguously requires a car
// or a meaningful (>$5) spend. The prompt carries the real constraint; this
// is the belt for drafts that ignored it.
const CAR_REQUIRED =
  /\b(drive|driving|drove|road trip|drive-?thr(?:u|ough)|carpool|in (?:your|the) car|by car)\b/i;
const PAID_ACTIVITY =
  /\b(tickets?|admission|cover charge|entry fee|rental|rent an?)\b|\$\s?(?:[5-9]|[1-9]\d+)\b/;

export function requiresCar(text: string): boolean {
  return CAR_REQUIRED.test(text);
}

export function requiresSpend(text: string): boolean {
  return PAID_ACTIVITY.test(text);
}

/**
 * Hard-drop pipeline, sequential so sibling dedup sees the growing kept
 * list (matching the stream path's progressive acceptance order).
 */
export function hardFilterQuests<Q extends RankableQuest>(
  candidates: Q[],
  opts: {
    previousTitles: string[];
    /** Titles already locked in (e.g. a quest the stream already emitted). */
    alreadyKeptTitles?: string[];
    walkingOnly: boolean;
    freeOnly: boolean;
    hooks: HardCheckHooks;
  },
): HardFilterResult<Q> {
  const kept: Q[] = [];
  const dropped: Array<{ title: string; reason: HardDropReason }> = [];
  const siblingTitles = [...(opts.alreadyKeptTitles ?? [])];
  for (const q of candidates) {
    if (
      !q ||
      typeof q.title !== "string" ||
      typeof q.description !== "string"
    ) {
      dropped.push({ title: String(q?.title ?? "<malformed>"), reason: "shape" });
      continue;
    }
    const haystack = `${q.title} ${q.description}`;
    if (opts.hooks.findSafetyViolation(haystack)) {
      dropped.push({ title: q.title, reason: "safety" });
      continue;
    }
    if (opts.hooks.isNearDuplicate(q.title, opts.previousTitles, siblingTitles)) {
      dropped.push({ title: q.title, reason: "duplicate" });
      continue;
    }
    if (opts.walkingOnly && requiresCar(haystack)) {
      dropped.push({ title: q.title, reason: "car_required" });
      continue;
    }
    if (opts.freeOnly && requiresSpend(haystack)) {
      dropped.push({ title: q.title, reason: "paid_activity" });
      continue;
    }
    kept.push(q);
    siblingTitles.push(q.title);
  }
  return { kept, dropped };
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export type ScoreContext = {
  /** Model-vocabulary categories matching the user's vibes (may be empty). */
  preferredCategories: Set<string>;
  /** True when >1 candidate in the pool is food-flavored. */
  batchFoodHeavy: boolean;
  isFood: (q: RankableQuest) => boolean;
};

/**
 * Mechanical quality score. Rewards SKILL.md's own checkable rules —
 * description 10-14 words (16 is the hard ceiling), title 5-8 words — plus
 * a soft vibe-match bonus and a non-food bonus when the pool is food-heavy.
 */
export function scoreQuest(q: RankableQuest, ctx: ScoreContext): number {
  let score = 0;
  const dw = wordCount(q.description);
  if (dw >= 10 && dw <= 14) score += 2;
  else if (dw <= 16) score += 1;
  else score -= 2; // over the ABSOLUTE HARD CEILING
  const tw = wordCount(q.title);
  if (tw >= 5 && tw <= 8) score += 1;
  if (ctx.preferredCategories.has(normCat(q.category))) score += 1.5;
  if (ctx.batchFoodHeavy && !ctx.isFood(q)) score += 1;
  return score;
}

function normCat(c: string): string {
  return (c ?? "").trim().toLowerCase();
}

export type SelectOptions = {
  target: number;
  preferredCategories: Set<string>;
  isFood: (q: RankableQuest) => boolean;
  /** True when the user explicitly requested the Food category. */
  allowFoodHeavy?: boolean;
  /** True when a food quest is already locked into the final batch
   * (e.g. the stream path emitted one before ranking ran). */
  foodAlreadyPicked?: boolean;
};

/**
 * Spread-aware selection of the top `target` quests.
 *
 * Slots 1..target-1 are greedy: highest score with a +2 bonus for a
 * category not yet picked, and (unless allowFoodHeavy) never a second
 * food quest — the constitution's anti-food rule is hard, so a thinner
 * batch beats a second food card.
 *
 * The final slot is the EXPLORATION slot: among survivors, prefer the
 * best-scoring quest whose category is OUTSIDE the user's vibe preferences
 * (and not already picked). This is the hedge against personalization
 * collapsing variety. Falls back to the ordinary greedy pick when no such
 * candidate exists (e.g. no vibes set, or everything matches).
 */
export function selectTopQuests<Q extends RankableQuest>(
  candidates: Q[],
  opts: SelectOptions,
): Q[] {
  const preferred = new Set(
    Array.from(opts.preferredCategories, (c) => normCat(c)),
  );
  const pool = candidates.map((q) => ({
    q,
    score: scoreQuest(q, {
      preferredCategories: preferred,
      batchFoodHeavy: candidates.filter((c) => opts.isFood(c)).length > 1,
      isFood: opts.isFood,
    }),
  }));
  const picked: Q[] = [];
  const pickedCats = new Set<string>();
  let foodPicked = opts.foodAlreadyPicked ?? false;

  const eligible = () =>
    pool.filter(
      ({ q }) => opts.allowFoodHeavy || !foodPicked || !opts.isFood(q),
    );

  const take = (entry: { q: Q; score: number }) => {
    picked.push(entry.q);
    pickedCats.add(normCat(entry.q.category));
    if (opts.isFood(entry.q)) foodPicked = true;
    pool.splice(pool.indexOf(entry), 1);
  };

  const bestBy = (
    entries: Array<{ q: Q; score: number }>,
    bonus: (q: Q) => number,
  ) => {
    let best: { q: Q; score: number } | null = null;
    let bestVal = -Infinity;
    for (const e of entries) {
      const v = e.score + bonus(e.q);
      if (v > bestVal) {
        bestVal = v;
        best = e;
      }
    }
    return best;
  };

  const spreadBonus = (q: Q) => (pickedCats.has(normCat(q.category)) ? 0 : 2);

  while (picked.length < Math.max(0, opts.target - 1)) {
    const pick = bestBy(eligible(), spreadBonus);
    if (!pick) break;
    take(pick);
  }

  if (picked.length < opts.target) {
    // Exploration slot: outside the vibe preferences and not a repeat
    // category, when such a survivor exists.
    const explorers =
      preferred.size > 0
        ? eligible().filter(
            ({ q }) =>
              !preferred.has(normCat(q.category)) &&
              !pickedCats.has(normCat(q.category)),
          )
        : [];
    const pick =
      bestBy(explorers, () => 0) ?? bestBy(eligible(), spreadBonus);
    if (pick) take(pick);
  }

  return picked;
}
