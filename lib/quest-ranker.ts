/**
 * Overgenerate-and-rank (M13 phase 4).
 *
 * The generator asks the model for 6 candidate quests and ships the best 3.
 * This module is the pure ranking half: hard drops first (safety, near-dup,
 * shared prop/mechanic vs siblings, detectable constraint violations), then
 * a mechanical score (description/title length vs SKILL.md's ceilings, vibe
 * match, food balance, stock-mechanic pressure) and a spread-aware selection
 * where the final slot is an EXPLORATION pick — the survivor least aligned
 * with the user's stated vibes — so personalization can't collapse variety.
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
  | "duplicate_prop"
  | "duplicate_mechanic"
  | "car_required"
  | "paid_activity";

// ---------- Prop / mechanic repetition belt ----------
//
// Two batch-collapse modes the title-similarity check cannot see, enforced
// mechanically here so they hold even when the model ignores SKILL.md's §5
// caps (Haiku self-diversifies less than Sonnet):
//   1. SINGLE-PROP FIXATION — structurally different quests all anchored on
//      one noun (a bet, a hunt, and a relay that are all about the same
//      material are one idea told three ways).
//   2. STOCK-MECHANIC REPETITION — the same over-used engine (relay,
//      decode/hidden-message, silent round, photograph-N, navigate-blind)
//      recurring within a batch and across consecutive batches.

/** Over-used core mechanics, each capped at one quest per batch. Patterns
 * are deliberately conservative — distinctive phrasing only, so a false hit
 * doesn't thin the candidate pool. */
export const MECHANIC_FAMILIES: ReadonlyArray<{ name: string; regex: RegExp }> =
  [
    {
      name: "relay",
      regex:
        /\brelay\b|\bpass(?:es|ing)?\s+(?:it|them|the\s+\w+)\s+(?:down|along|to\s+the\s+next)\b|\bhand(?:s|ing)?\s+(?:it|them|the\s+\w+)\s+(?:off|to\s+the\s+next)\b|\btak(?:e|es|ing)\s+turns\s+adding\b/i,
    },
    {
      name: "decode",
      regex:
        /\b(?:decode|decoding|decipher|encoded|cipher|hidden\s+(?:message|note|clue)|secret\s+(?:message|code|note)|coded\s+(?:message|note|clue))\b/i,
    },
    {
      name: "silent",
      regex:
        /\b(?:silent|silently|silence|without\s+(?:talking|speaking|words|saying)|no\s+(?:talking|speaking)|gestures?\s+only|only\s+gestures|mime|miming)\b/i,
    },
    {
      // "photograph N things of a category" camera-scavengers. A single
      // end-of-quest proof photo has no count nearby and does NOT match.
      name: "photo_count",
      regex:
        /\b(?:photograph|photo|snap|picture)\w*\b[^.!?]{0,40}\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.!?]{0,25}\b(?:photos?|photographs?|pictures?|snaps?)\b/i,
    },
    {
      name: "navigate_blind",
      regex:
        /\b(?:blindfold(?:ed)?|walk(?:s|ing)?\s+backwards?|navigate\w*[^.!?]{0,30}\b(?:backwards?|blind|landmarks?\s+only|without\s+(?:gps|a\s+map|maps|phones?))|by\s+landmarks?\s+only|eyes\s+closed)\b/i,
    },
  ];

/** Mechanic families detected in a quest's title + description (or in a
 * bare title, for cross-batch checks against previousTitles). */
export function detectMechanics(text: string): string[] {
  const out: string[] = [];
  for (const f of MECHANIC_FAMILIES) {
    if (f.regex.test(text)) out.push(f.name);
  }
  return out;
}

// Words that can never count as a quest's distinctive anchor: grammar and
// glue, people words, quest-form words, ubiquitous proof/media words,
// generic venue types, time words, high-frequency quest verbs, judging
// glue, common descriptors, and number words. Curated for precision — a
// missed anchor is a soft failure (the prompt still fights it); a false
// shared-anchor drop thins the candidate pool. Distinctive prop/motif nouns
// (chalk, balloon, storefront, sunset, tower…) stay anchorable on purpose.
const ANCHOR_STOPWORDS = new Set<string>([
  // grammar / glue
  "the", "and", "but", "nor", "with", "without", "from", "into", "onto",
  "over", "under", "down", "out", "off", "that", "these", "those", "this",
  "your", "yours", "their", "them", "they", "then", "than", "each", "every",
  "all", "any", "some", "none", "nothing", "only", "just", "most", "more",
  "least", "less", "own", "same", "other", "another", "both", "either",
  "neither", "while", "until", "before", "after", "during", "once", "twice",
  "again", "still", "ever", "never", "also", "even", "like", "via", "per",
  "instead", "together", "apart", "exactly", "about", "against", "through",
  "between", "behind", "across", "toward", "towards", "along", "around",
  "inside", "outside", "someone", "something", "anything", "everything",
  "whoever", "whatever", "whichever", "where", "when", "what", "here",
  "there", "back", "away", "left", "right", "near", "nearby", "local",
  // people
  "group", "crew", "everyone", "everybody", "anyone", "friend", "people",
  "person", "member", "team", "partner", "player", "opponent", "side",
  "pair", "solo", "whole", "gang", "squad", "passerby", "passersby",
  // quest-form
  "quest", "challenge", "game", "mission", "adventure", "contest",
  "tournament", "showdown", "battle", "round", "level", "rule", "turn",
  "point", "score", "scored", "scoring", "win", "winner", "winning", "lose",
  "loser", "losing", "prize", "stake", "bet", "wager", "goal", "task",
  "edition", "mode",
  // proof / media / devices (§4 wants filmable, §6.8 wants a proof photo —
  // these words appear in half of all quests)
  "photo", "photograph", "picture", "selfie", "video", "clip", "film",
  "camera", "phone", "screen", "proof", "evidence", "shot", "recap",
  // generic venue types (setting overlap is the prompt's job; only true
  // prop/motif overlap should hard-drop)
  "park", "street", "store", "shop", "spot", "place", "corner", "block",
  "neighborhood", "town", "city", "home", "house", "apartment", "room",
  "aisle", "area", "venue", "location", "cafe", "restaurant", "mall",
  "market", "supermarket", "library", "museum", "playground", "cinema",
  "theater", "theatre", "station", "sidewalk", "entrance", "exit", "door",
  "indoor", "indoors", "outdoor", "outdoors", "public",
  // time
  "minute", "hour", "second", "time", "today", "tonight", "night", "day",
  "week", "weekend", "morning", "afternoon", "evening", "midnight",
  // high-frequency quest verbs (core-verb diversity is handled by the
  // lead-verb penalty in selection, not by anchor matching)
  "find", "walk", "make", "take", "get", "give", "going", "turn", "pick",
  "play", "start", "end", "meet", "try", "use", "see", "watch", "look",
  "tell", "say", "ask", "keep", "hold", "put", "set", "let", "send",
  "bring", "choose", "grab", "head", "run", "race", "chase", "sprint",
  "visit", "order", "buy", "pay", "eat", "drink", "snap", "count", "swap",
  "trade", "guess", "draw", "hide", "hunt", "build", "stack", "climb",
  "read", "write", "share", "shared", "sharing", "begin", "begins",
  "finish", "finishes", "complete", "completes", "return", "returns",
  "arrive", "arrives", "leave", "leaves", "stay", "stays", "stop", "stops",
  "wait", "waits", "declare", "declares", "crown", "crowned", "crowns",
  // judging glue
  "vote", "votes", "voting", "judge", "judged", "judging", "rate", "rated",
  "rating",
  // descriptors
  "new", "old", "first", "last", "next", "best", "worst", "random",
  "secret", "hidden", "full", "half", "single", "double", "triple",
  "couple", "dozen", "entire", "total", "final", "finally", "weird",
  "weirdest", "wild", "wildest", "crazy", "craziest", "silly", "silliest",
  "funny", "funniest", "fast", "fastest", "slow", "slowest", "tall",
  "tallest", "big", "biggest", "small", "smallest", "long", "longest",
  "short", "shortest", "high", "highest", "low", "lowest", "close",
  "closest", "nearest", "deep", "deepest", "cheap", "cheapest", "quiet",
  "loud", "free", "real", "fake", "perfect", "favorite",
  // numbers
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten",
  // misc glue nouns
  "thing", "item", "object", "stuff", "way", "route", "path", "word",
  "line", "list", "money", "dollar", "buck", "hand", "hands", "foot",
  "feet", "eye", "eyes", "face", "voice", "body", "staff",
]);

/**
 * Distinctive content tokens of a quest — what's left of title+description
 * after stopwords, short tokens, and a crude singularization. Two sibling
 * quests sharing ANY anchor token are treated as one idea told twice.
 */
export function anchorTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const t = raw.replace(/'/g, "");
    if (t.length < 4 || ANCHOR_STOPWORDS.has(t)) continue;
    const sing =
      t.length > 4 && t.endsWith("s") && !t.endsWith("ss")
        ? t.slice(0, -1)
        : t;
    if (ANCHOR_STOPWORDS.has(sing)) continue;
    out.add(sing);
  }
  return out;
}

export type BatchConflict = {
  reason: "duplicate_prop" | "duplicate_mechanic";
  /** The shared anchor token or mechanic family name. */
  shared: string;
  withTitle: string;
};

/**
 * Does the candidate collide with an already-kept sibling on a central
 * prop/motif noun or on a capped mechanic family? Kept quests may carry an
 * empty description (title-only contexts) — the checks degrade gracefully.
 */
export function findBatchConflict(
  candidate: RankableQuest,
  kept: ReadonlyArray<RankableQuest>,
): BatchConflict | null {
  const text = `${candidate.title} ${candidate.description}`;
  const anchors = anchorTokens(text);
  const mechanics = detectMechanics(text);
  for (const k of kept) {
    const kText = `${k.title} ${k.description ?? ""}`;
    const kAnchors = anchorTokens(kText);
    for (const a of Array.from(anchors)) {
      if (kAnchors.has(a)) {
        return { reason: "duplicate_prop", shared: a, withTitle: k.title };
      }
    }
    if (mechanics.length > 0) {
      const kMechanics = new Set(detectMechanics(kText));
      for (const m of mechanics) {
        if (kMechanics.has(m)) {
          return {
            reason: "duplicate_mechanic",
            shared: m,
            withTitle: k.title,
          };
        }
      }
    }
  }
  return null;
}

/** First word of the (imperative, second-person) description — in this
 * corpus effectively the quest's core verb. */
export function leadVerb(description: string): string {
  const m = (description ?? "").trim().toLowerCase().match(/^[a-z']+/);
  return m ? m[0].replace(/'/g, "") : "";
}

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
    /** Quests already locked in (e.g. one the stream already emitted, or
     * the surviving pool a shortfall re-ask is topping up). Their titles
     * feed near-dup checks; their full text feeds prop/mechanic checks. */
    alreadyKept?: RankableQuest[];
    walkingOnly: boolean;
    freeOnly: boolean;
    hooks: HardCheckHooks;
  },
): HardFilterResult<Q> {
  const kept: Q[] = [];
  const dropped: Array<{ title: string; reason: HardDropReason }> = [];
  const alreadyKept = opts.alreadyKept ?? [];
  const siblingTitles = alreadyKept.map((k) => k.title);
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
    // Anti-fixation belt: no two batch members built around the same
    // central prop/motif noun or the same capped mechanic family.
    const conflict = findBatchConflict(q, [...alreadyKept, ...kept]);
    if (conflict) {
      dropped.push({ title: q.title, reason: conflict.reason });
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
  /** Mechanic families visible in the user's recent titles (cross-batch). */
  recentMechanics?: Set<string>;
};

/**
 * Mechanical quality score. Rewards SKILL.md's own checkable rules —
 * description 10-14 words (16 is the hard ceiling), title 5-8 words — plus
 * a soft vibe-match bonus and a non-food bonus when the pool is food-heavy.
 * Stock mechanics (the §5 capped families) score BELOW fresh mechanics, and
 * further below when the user's recent titles show the same mechanic — so a
 * relay only ships when nothing fresher survived, and never right after the
 * user just saw one.
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
  for (const m of detectMechanics(`${q.title} ${q.description}`)) {
    score -= 1;
    if (ctx.recentMechanics?.has(m)) score -= 2;
  }
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
  /** Recent (cross-batch) titles — mechanics detected here are penalized
   * so the same stock engine doesn't recur roll after roll. */
  previousTitles?: string[];
  /** Quests already locked into the final batch (e.g. the stream path's
   * first emitted card) — seeds the category and core-verb spread so the
   * remaining slots can't repeat them. */
  alreadyPicked?: RankableQuest[];
};

/**
 * Spread-aware selection of the top `target` quests.
 *
 * Slots 1..target-1 are greedy: highest score with a +2 bonus for a
 * category not yet picked, a penalty for repeating a picked quest's core
 * (lead) verb, and (unless allowFoodHeavy) never a second food quest — the
 * constitution's anti-food rule is hard, so a thinner batch beats a second
 * food card.
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
  const recentMechanics = new Set<string>();
  for (const t of opts.previousTitles ?? []) {
    for (const m of detectMechanics(t)) recentMechanics.add(m);
  }
  const pool = candidates.map((q) => ({
    q,
    score: scoreQuest(q, {
      preferredCategories: preferred,
      batchFoodHeavy: candidates.filter((c) => opts.isFood(c)).length > 1,
      isFood: opts.isFood,
      recentMechanics,
    }),
  }));
  const picked: Q[] = [];
  const pickedCats = new Set<string>();
  const pickedVerbs = new Set<string>();
  for (const p of opts.alreadyPicked ?? []) {
    pickedCats.add(normCat(p.category));
    const v = leadVerb(p.description);
    if (v) pickedVerbs.add(v);
  }
  let foodPicked = opts.foodAlreadyPicked ?? false;

  const eligible = () =>
    pool.filter(
      ({ q }) => opts.allowFoodHeavy || !foodPicked || !opts.isFood(q),
    );

  const take = (entry: { q: Q; score: number }) => {
    picked.push(entry.q);
    pickedCats.add(normCat(entry.q.category));
    const v = leadVerb(entry.q.description);
    if (v) pickedVerbs.add(v);
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
  // "Distinct core verb per quest": descriptions are imperative, so the
  // lead word is effectively the core verb. Repeats aren't excluded
  // outright (the pool may be thin) — just pushed behind fresh verbs.
  const verbPenalty = (q: Q) => {
    const v = leadVerb(q.description);
    return v && pickedVerbs.has(v) ? -1.5 : 0;
  };
  const slotBonus = (q: Q) => spreadBonus(q) + verbPenalty(q);

  while (picked.length < Math.max(0, opts.target - 1)) {
    const pick = bestBy(eligible(), slotBonus);
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
      bestBy(explorers, verbPenalty) ?? bestBy(eligible(), slotBonus);
    if (pick) take(pick);
  }

  return picked;
}
