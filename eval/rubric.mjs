// Deterministic rubric scorer for the side-quest eval harness.
//
// This is intentionally an INDEPENDENT re-implementation of the food / venue /
// diversity / doability checks — it does NOT import lib/quest-prompt.ts. An
// eval that reused the route's own detectors would be circular (it would only
// confirm the route agrees with itself). Each axis returns a 0..1 score plus a
// human-readable detail string so failures are debuggable.
//
// Axes (one per requirement in the task):
//   foodCap     — at most 1 food quest per batch of 3
//   diversity   — distinct categories + distinct settings within the batch
//   venueLeak   — no proper noun from the scenario's nearby list leaks into output
//   doability   — quests are concrete, actionable, and not an auto-reject shape

// --- Food detection (independent keyword list) -------------------------------
const FOOD_WORDS = [
  "restaurant", "cafe", "coffee", "food", "eat", "eating", "diner", "burger",
  "pizza", "taco", "snack", "breakfast", "lunch", "dinner", "drink", "bar",
  "pub", "brewery", "sushi", "dessert", "ice cream", "menu", "drive-thru",
  "drive-through", "fast food", "takeout", "meal", "brunch", "cuisine", "bakery",
  "barista", "espresso", "smoothie", "boba", "milkshake",
];

export function isFood(quest) {
  if ((quest.category ?? "") === "Food") return true;
  const t = `${quest.title ?? ""} ${quest.description ?? ""}`.toLowerCase();
  return FOOD_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(t));
}

// --- Setting inference (for diversity) ---------------------------------------
const SETTING_PATTERNS = {
  store: /\b(store|supermarket|grocery|mall|aisle|register|checkout|cart|big-box|shop)\b/,
  restaurant: /\b(restaurant|cafe|diner|drive-?thru|bar|menu|counter)\b/,
  park: /\b(park|trail|hill|lake|river|field|outdoor|sunrise|viewpoint|nature)\b/,
  home: /\b(home|apartment|couch|living room|kitchen|pantry|backyard)\b/,
  street: /\b(street|sidewalk|block|neighborhood|alley|crosswalk|parking lot)\b/,
  transit: /\b(bus|train|subway|transit|drive|car|roadtrip|road trip)\b/,
  venue: /\b(library|museum|gym|court|stadium|cinema|theatre|theater|rink|alley)\b/,
};

function inferSetting(quest) {
  const t = `${quest.title ?? ""} ${quest.description ?? ""}`.toLowerCase();
  for (const [name, re] of Object.entries(SETTING_PATTERNS)) {
    if (re.test(t)) return name;
  }
  return "other";
}

// --- Auto-reject "failure mode" detectors (for doability) --------------------
const FAILURE_MODES = [
  {
    name: "writing/reflection",
    re: /\b(journal|write down|reflect|gratitude|diary|essay|list your)\b/,
  },
  {
    name: "verbal-rule overlay",
    re: /\bonly (speak|talk|communicate) in\b|\bevery (sentence|word) must\b/,
  },
  {
    name: "synchronized-performance trap",
    re: /\b(conga line|slow clap|flash ?mob|silent stare|freeze in place|synchronized (dance|clap))\b/,
  },
  {
    name: "code-name/rule-overlay sport",
    re: /\b(secret (code|handshake|word)|code word|code name).{0,40}\b(basketball|soccer|game|score|basket|goal)\b|\b(basketball|soccer|volleyball).{0,40}\b(secret (code|word)|code name)\b/,
  },
];

// Concrete-action signal: a quest should describe a real physical action.
// Stems are matched with an inflection-tolerant suffix group so "order" also
// catches "orders/ordered/ordering" and "race" catches "races/raced/racing".
const ACTION_STEMS = [
  "rac", "driv", "walk", "run", "find", "build", "trad", "barter", "order",
  "ask", "climb", "hik", "swap", "hid", "collect", "photograph", "play",
  "join", "host", "pour", "sketch", "map", "deliver", "stag", "strut", "pick",
  "meet", "search", "navigat", "grab", "stack", "pil", "count", "queu", "rat",
  "claim", "bowl", "buy", "buil", "cook", "pretend", "trade", "race", "hide",
  "stage", "queue", "pile", "navigate", "hike", "rate", "explore", "wander",
  "challeng", "compet", "swim", "dance", "perform", "carry", "deliver",
];
const ACTION_VERB = new RegExp(
  `\\b(?:${ACTION_STEMS.join("|")})(?:e?s|ed|ing)?\\b`,
);

export function isDoable(quest) {
  const text = `${quest.title ?? ""} ${quest.description ?? ""}`;
  const lower = text.toLowerCase();
  for (const fm of FAILURE_MODES) {
    if (fm.re.test(lower)) return { ok: false, reason: fm.name };
  }
  if ((quest.description ?? "").trim().length < 40) {
    return { ok: false, reason: "too thin (no concrete plan)" };
  }
  if (!ACTION_VERB.test(lower)) {
    return { ok: false, reason: "no concrete action verb" };
  }
  return { ok: true, reason: "" };
}

// --- Per-batch scoring -------------------------------------------------------
//
// quests: array of { title, description, category }
// leakNames: array of proper nouns the output must NOT contain.
export function scoreBatch(quests, leakNames = []) {
  const n = quests.length || 1;

  // (a) food cap: at most 1 food quest.
  const foodQuests = quests.filter(isFood);
  const foodCount = foodQuests.length;
  const foodCap = foodCount <= 1 ? 1 : Math.max(0, 1 - (foodCount - 1) / 2);

  // (b) diversity: distinct categories + distinct settings.
  const cats = new Set(quests.map((q) => (q.category ?? "?").toLowerCase()));
  const settings = new Set(quests.map(inferSetting));
  const catRatio = cats.size / n;
  const settingRatio = settings.size / n;
  const diversity = 0.6 * catRatio + 0.4 * settingRatio;

  // (c) venue leak: fraction of quests with zero proper-noun leaks.
  const escaped = leakNames
    .filter((s) => typeof s === "string" && s.length >= 3)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const leaks = [];
  let cleanQuests = 0;
  for (const q of quests) {
    const hay = `${q.title ?? ""} ${q.description ?? ""}`;
    const hit = escaped.find((e) => new RegExp(`\\b${e}\\b`, "i").test(hay));
    if (hit) leaks.push(hit);
    else cleanQuests++;
  }
  const venueLeak = quests.length ? cleanQuests / n : 1;

  // (d) doability.
  const doableResults = quests.map(isDoable);
  const doableCount = doableResults.filter((r) => r.ok).length;
  const doability = quests.length ? doableCount / n : 0;
  const undoable = doableResults
    .map((r, i) => (r.ok ? null : `"${quests[i].title}" (${r.reason})`))
    .filter(Boolean);

  const composite = (foodCap + diversity + venueLeak + doability) / 4;

  return {
    composite,
    axes: { foodCap, diversity, venueLeak, doability },
    details: {
      foodCount,
      categories: [...cats],
      settings: [...settings],
      leaks,
      undoable,
    },
  };
}

// Average a list of per-batch results into an aggregate.
export function aggregate(results) {
  const n = results.length || 1;
  const sum = (sel) => results.reduce((s, r) => s + sel(r), 0) / n;
  return {
    composite: sum((r) => r.composite),
    axes: {
      foodCap: sum((r) => r.axes.foodCap),
      diversity: sum((r) => r.axes.diversity),
      venueLeak: sum((r) => r.axes.venueLeak),
      doability: sum((r) => r.axes.doability),
    },
    n: results.length,
  };
}
