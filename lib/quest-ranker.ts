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
  /** Emitted plan fields (M15 generation-time enforcement, SKILL.md §9):
   * the model commits to a register code, central prop, core verb, and
   * stake type BEFORE writing the prose. All optional — every declaration
   * is validated against content, never trusted bare — and all stripped
   * by normalize() before anything reaches a client. */
  g?: string; // register code: phys|social|brain|maker|cozy|explore|compete
  p?: string; // central prop/motif, 1-2 words
  v?: string; // core verb
  s?: string; // stake type: win|reveal|kickout|artifact|natural
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
  | "contradiction"
  | "car_required"
  | "paid_activity";

// ---------- Self-contradiction detector (M15) ----------
//
// The audited failure class: a quest whose own constraint bans the tool the
// quest requires (a phone-free quest that needs a phone camera). Paired
// conservative regexes; a quest tripping BOTH is incoherent as written and
// hard-drops (reason "contradiction"), feeding the normal re-ask path.
const NO_PHONE_CONSTRAINT =
  /\b(?:no\s+phones?\b|phones?\s+(?:stay|off|banned|away|down|zipped)|without\s+(?:your\s+|any\s+)?phones?|phone[- ]free)/i;
const PHONE_REQUIRED =
  /\b(?:film\w*|record\w*|photograph\w*|photos?\b|snap\w*|selfie\w*|video\w*|playlist|timer\s+on\s+your\s+phone|edit(?:ing)?\s+apps?|google|livestream\w*)\b/i;

export function isSelfContradictory(text: string): boolean {
  return NO_PHONE_CONSTRAINT.test(text) && PHONE_REQUIRED.test(text);
}

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
  "somewhere", "anywhere", "everywhere", "nowhere",
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
    // > 3, not > 4: four-letter plurals ("wins", "bets", "ways") must still
    // reduce to their stopworded singular — with the stakes gate pushing
    // most descriptions to end in "…wins", leaving "wins" anchorable made
    // any two staked quests collide as duplicate_prop (caught in the M15
    // end-to-end verification run).
    const sing =
      t.length > 3 && t.endsWith("s") && !t.endsWith("ss")
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
  // Declared central props (§9 plan field "p") join the anchor set, so two
  // candidates COMMITTING to the same prop conflict exactly even when the
  // prose words differ; text anchors stay as the belt for undeclared or
  // lying candidates.
  const text = `${candidate.title} ${candidate.description} ${candidate.p ?? ""}`;
  const anchors = anchorTokens(text);
  const mechanics = detectMechanics(text);
  for (const k of kept) {
    const kText = `${k.title} ${k.description ?? ""} ${k.p ?? ""}`;
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

/** Core verb of a quest: the description's lead word, falling back to the
 * declared §9 plan field "v" when the lead word is unusable. */
export function coreVerb(q: RankableQuest): string {
  return leadVerb(q.description) || leadVerb(q.v ?? "");
}

// ---------- Interest registers (two-axis grid) ----------
//
// SKILL.md §3 axis 2: what KIND of fun a quest is. Detection here is a
// LOCAL keyword heuristic — no model call — and register spread is a
// selection-time PREFERENCE only (a small scoring tiebreaker in
// selectTopQuests), never a hard drop, so it cannot thin the candidate
// pool or trigger extra re-asks. Patterns are ordered most-specific
// first; the first match wins, and no match returns null (no bonus, no
// penalty).

export const REGISTER_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> =
  [
    {
      name: "social-performative",
      regex:
        /\b(?:cashier|employee|clerk|barista|staff|strangers?|deadpan|in[- ]character|role[- ]?play\w*|accent|persona|improv|perform\w*|convince|persuade|audience)\b/i,
    },
    {
      name: "cerebral-puzzle",
      regex:
        /\b(?:puzzle|riddle|deduc\w+|estimat\w+|memori[sz]e|memory|trivia|quiz|logic|mystery|clues?|decode|cipher|guess\w*)\b/i,
    },
    {
      name: "creative-maker",
      regex:
        /\b(?:build\w*|sketch\w*|draw\w*|doodle\w*|craft\w*|design\w*|compose|invent\w*|assembl\w+|sculpt\w*|fold\w*|paint\w*|decorate|collage|origami)\b/i,
    },
    {
      name: "sensory-cozy",
      regex:
        /\b(?:sunrise|sunset|stargaz\w+|cozy|calm\w*|quiet\w*|listen\w*|playlist|blanket|breeze|clouds?|savor\w*|golden hour|ambient)\b/i,
    },
    {
      name: "exploratory-discovery",
      regex:
        /\b(?:explor\w+|wander\w*|discover\w*|unfamiliar|uncharted|scout\w*|roam\w*|trek\w*|never (?:been|visited)|new[- ]to[- ]you)\b/i,
    },
    {
      name: "competitive",
      regex:
        /\b(?:tournament|bracket|best[- ]of[- ]\w+|head[- ]to[- ]head|duel|showdown|face[- ]off|1v1|versus|champion\w*|wager|bets?)\b/i,
    },
    {
      name: "active-physical",
      regex:
        /\b(?:sprint\w*|climb\w*|hik\w+|jog\w*|laps?|stairs|balanc\w+|obstacle|parkour|rac(?:e|es|ing)|dash|throw\w*|catch|kick\w*|jump\w*|carry\w*|piggyback)\b/i,
    },
  ];

export function detectRegister(text: string): string | null {
  for (const r of REGISTER_PATTERNS) {
    if (r.regex.test(text)) return r.name;
  }
  return null;
}

/** §9 plan-field register codes → full register names. */
export const REGISTER_CODES: Record<string, string> = {
  phys: "active-physical",
  social: "social-performative",
  brain: "cerebral-puzzle",
  maker: "creative-maker",
  cozy: "sensory-cozy",
  explore: "exploratory-discovery",
  compete: "competitive",
};

/**
 * Register of a quest: textual evidence first (a declaration that
 * contradicts the prose is a lie), the declared plan code as the
 * fallback when keywords are inconclusive. Null when neither knows.
 */
export function resolveRegister(q: RankableQuest): string | null {
  const detected = detectRegister(`${q.title} ${q.description}`);
  if (detected) return detected;
  const code = (q.g ?? "").trim().toLowerCase();
  return REGISTER_CODES[code] ?? null;
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

// Multi-venue coordination ("do X across N stops/shops") is the top
// human-scored feasibility failure mode. SOFT signal only: it feeds a
// scoring deduction in scoreQuest, never a hard drop, so it cannot thin
// the candidate pool or trigger re-asks. Same conservative keyword style
// as CAR_REQUIRED/PAID_ACTIVITY above.
const MULTI_VENUE =
  /\bat (?:each|every) (?:stop|store|shop|venue|location|cafe|bar|restaurant|business)\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:different\s+)?(?:stops|stores|shops|venues|locations|businesses|cafes|bars|restaurants)\b|\b(?:store|shop|cafe|bar|restaurant)\s+to\s+(?:store|shop|cafe|bar|restaurant)\b|\bmulti[- ]stop\b/i;
// When the journey itself is the quest (expeditions, wanders, crawls),
// multiple waypoints are the point, not a logistics burden — exempt.
const JOURNEY_POINT =
  /\b(?:expedition|trek\w*|hik\w+|wander\w*|stroll|walking tour|road trip|loop|trail|summit|viewpoint|journey|pilgrimage|crawl)\b/i;

export function requiresMultiVenue(text: string): boolean {
  return MULTI_VENUE.test(text) && !JOURNEY_POINT.test(text);
}

// SKILL.md §4 axis 4 (stakes/retellability gate), enforced softly. A
// 102-quest human audit found the largest failure bucket was no-stakes
// busywork — assemble/collect/stack something, photograph it, done — which
// the prompt-side gate alone does not stop. A quest with no detectable
// resolution moment ranks behind staked siblings; the assemble-and-document
// template is pushed further back. Scoring only, never a hard drop.
const RESOLUTION_MARKERS =
  /\b(?:wins?|winners?|winning|lose|loses|losers?|losing|crown\w*|champion\w*|judge\w*|vot(?:e|es|ed|ing)|first\s+to|last\s+(?:one|person)\s+(?:standing|wins|left)|fastest|reveal\w*|guess\w*|scor(?:e|es|ed|ing)|points?|dar(?:e|es|ed)|tally\w*|rank(?:s|ed|ing)?|bragging|before\s+(?:the\s+)?(?:timer|clock)|time(?:'s|\s+runs?)\s+(?:up|out)|kicked\s+out|showdown|head[- ]to[- ]head)\b/i;
// "…photograph the result/finished thing" as the quest's payoff.
const DOCUMENT_ONLY_END =
  /\b(?:photograph|photo|snap|document|picture)\w*[^.!?]{0,40}\b(?:result|finished|final|structure|sculpture|creation|masterpiece|before\s+leaving)\b/i;

export function lacksStakes(text: string): boolean {
  return !RESOLUTION_MARKERS.test(text);
}

export function isDocumentOnlyEnd(text: string): boolean {
  return DOCUMENT_ONLY_END.test(text);
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
    // Incoherent-as-written: the quest's own constraint bans a tool the
    // quest requires. Cannot be repaired deterministically — drop.
    if (isSelfContradictory(haystack)) {
      dropped.push({ title: q.title, reason: "contradiction" });
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
  const text = `${q.title} ${q.description}`;
  const dw = wordCount(q.description);
  if (dw >= 10 && dw <= 14) score += 2;
  else if (dw <= 16) score += 1;
  else score -= 2; // over the ABSOLUTE HARD CEILING
  const tw = wordCount(q.title);
  if (tw >= 5 && tw <= 8) score += 1;
  if (ctx.preferredCategories.has(normCat(q.category))) score += 1.5;
  if (ctx.batchFoodHeavy && !ctx.isFood(q)) score += 1;
  for (const m of detectMechanics(text)) {
    score -= 1;
    if (ctx.recentMechanics?.has(m)) score -= 2;
  }
  // SKILL.md §4 axis 7's logistics clause, enforced softly: multi-venue
  // errand-chains rank behind logistically simple siblings.
  if (requiresMultiVenue(text)) score -= 1.5;
  // §4 axis 4 stakes gate, enforced softly. -1 keeps it a tiebreaker for
  // legitimately stake-free registers (cooperative builds with an artifact
  // end, sensory-cozy rituals with a natural end); the extra -1.5 targets
  // the assemble-and-photograph busywork template specifically.
  if (lacksStakes(text)) {
    score -= 1;
    if (isDocumentOnlyEnd(text)) score -= 1.5;
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
 * (lead) verb, a ±1 tiebreaker preferring an interest register not yet
 * picked (§3 axis 2 — never a drop), and (unless allowFoodHeavy) never a
 * second food quest — the constitution's anti-food rule is hard, so a
 * thinner batch beats a second food card.
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
  // Lead words of recent titles approximate recently-used core verbs
  // (titles are usually verb-led). Articles are skipped; noun-led titles
  // add harmless noise since descriptions never open with a noun phrase.
  const recentVerbs = new Set<string>();
  for (const t of opts.previousTitles ?? []) {
    for (const m of detectMechanics(t)) recentMechanics.add(m);
    const v = leadVerb(t);
    if (v && v !== "the" && v !== "a" && v !== "an") recentVerbs.add(v);
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
  const pickedRegisters = new Set<string>();
  let pickedStakeFree = 0;
  for (const p of opts.alreadyPicked ?? []) {
    pickedCats.add(normCat(p.category));
    const v = coreVerb(p);
    if (v) pickedVerbs.add(v);
    const r = resolveRegister(p);
    if (r) pickedRegisters.add(r);
    if (lacksStakes(`${p.title} ${p.description}`)) pickedStakeFree++;
  }
  let foodPicked = opts.foodAlreadyPicked ?? false;

  const eligible = () =>
    pool.filter(
      ({ q }) => opts.allowFoodHeavy || !foodPicked || !opts.isFood(q),
    );

  const take = (entry: { q: Q; score: number }) => {
    picked.push(entry.q);
    pickedCats.add(normCat(entry.q.category));
    const v = coreVerb(entry.q);
    if (v) pickedVerbs.add(v);
    const r = resolveRegister(entry.q);
    if (r) pickedRegisters.add(r);
    if (lacksStakes(`${entry.q.title} ${entry.q.description}`)) pickedStakeFree++;
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
  // outright (the pool may be thin) — just pushed hard behind fresh
  // verbs. -3 outweighs the +2 category-spread bonus, so a repeated verb
  // can no longer win a slot on category spread alone; the milder -1
  // fires when the verb led a recent title (session-level dominance —
  // human scoring found one core verb claiming 4 of 14 quests).
  const verbPenalty = (q: Q) => {
    const v = coreVerb(q);
    if (!v) return 0;
    if (pickedVerbs.has(v)) return -3;
    if (recentVerbs.has(v)) return -1;
    return 0;
  };
  // Register-diversity preference (§3 axis 2 / §5 C10): a small tiebreaker
  // so the shipped batch spans distinct interest registers when the pool
  // allows it. Deliberately weaker than the category-spread bonus, and
  // inert (0) when neither keywords nor the declared plan can classify.
  const registerBonus = (q: Q) => {
    const r = resolveRegister(q);
    if (!r) return 0;
    return pickedRegisters.has(r) ? -1 : 1;
  };
  // §9 stake rule: at most one stake-free (artifact/natural-end) quest per
  // shipped batch — a second one ranks well behind staked alternatives.
  const stakeFreePenalty = (q: Q) =>
    pickedStakeFree >= 1 && lacksStakes(`${q.title} ${q.description}`) ? -2 : 0;
  const slotBonus = (q: Q) =>
    spreadBonus(q) + verbPenalty(q) + registerBonus(q) + stakeFreePenalty(q);

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
      bestBy(explorers, (q) => verbPenalty(q) + registerBonus(q) + stakeFreePenalty(q)) ??
      bestBy(eligible(), slotBonus);
    if (pick) take(pick);
  }

  return picked;
}
