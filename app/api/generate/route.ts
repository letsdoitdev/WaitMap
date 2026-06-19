import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { QuestCategory } from "@/lib/quests";
import { GeneratedQuest } from "@/lib/generate";
import { NearbyBucket, NearbyPlace } from "@/lib/nearby";
import { createClient } from "@/lib/supabase/server";
import { FREE_DAILY_REROLLS, getUtcDateKey } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupSizeBand = "solo" | "2" | "group";

type GenerateBody = {
  location?: string;
  /** Coarse resolved region descriptor (e.g. "Ashburn, Virginia, USA") used
   * ONLY for geographic plausibility — never to name venues. Falls back to
   * `location` when absent. */
  region?: string;
  /** Full place objects (still needed for the venue-leak detector and the
   * scrub-time category placeholder). Histogram is built from typeCounts,
   * not from this list. */
  nearbyPlaces?: Array<Pick<NearbyPlace, "name" | "type"> & { bucket?: NearbyBucket }>;
  /** Per-bucket counts pre-computed by /api/nearby-places (post-cap). */
  categoryCounts?: Partial<Record<NearbyBucket, number>>;
  /** Per-OSM-type counts pre-computed by /api/nearby-places (post-cap).
   * This is the canonical source for the histogram so caps are honored. */
  typeCounts?: Record<string, number>;
  spiceLevel?: number;
  groupSize?: GroupSizeBand;
  timeAvailable?: number;
  excludeIds?: string[];
  previousTitles?: string[];
  category?: string | null;
  canDrive?: boolean;
  lowCostOnly?: boolean;
};

// Slim schema as returned by the model. To keep output tokens (the dominant
// latency term for a single Haiku call) minimal, the model now returns only
// title/description/category — duration, groupSize and spiceLevel are filled
// server-side from the user's own inputs. The extra fields stay optional so a
// model that still emits them is parsed without error.
type ClaudeQuest = {
  id?: string;
  title: string;
  description: string;
  category: string;
  duration?: string; // optional; "1-2 hours", "30 minutes"
  groupSize?: string; // optional; "2-4 people", "solo"
  spiceLevel?: number; // optional
  rating?: null;
};

const V4_CATEGORIES = [
  "Outdoor",
  "Food",
  "Social",
  "Challenge",
  "Culture",
  "Nightlife",
  "Creative",
  "Indoor",
] as const;

const V4_TO_QUEST_CATEGORY: Record<string, QuestCategory> = {
  Outdoor: "Outdoor",
  Food: "Food",
  Social: "Social",
  Challenge: "Chaos",
  Culture: "Creative",
  Nightlife: "Late Night",
  Creative: "Creative",
  Indoor: "Indoor",
};

const UI_CATEGORIES: QuestCategory[] = [
  "Chaos",
  "Outdoor",
  "Social",
  "Creative",
  "Food",
  "Late Night",
  "Chill",
  "Fitness",
  "Nature",
  "Tech",
  "Exploration",
  "Indoor",
];
function isUiCategory(s: string): s is QuestCategory {
  return (UI_CATEGORIES as string[]).includes(s);
}
function isV4Category(s: string): boolean {
  return (V4_CATEGORIES as readonly string[]).includes(s);
}

// ---------- Load skill body at module load ----------

function loadSkillBody(): string {
  const candidates = [
    path.join(process.cwd(), ".claude/skills/side-quest-generator/SKILL.md"),
    path.join(
      process.cwd(),
      ".next/server/.claude/skills/side-quest-generator/SKILL.md",
    ),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      // Strip YAML frontmatter between leading `---` markers.
      return raw.replace(/^---\n[\s\S]*?\n---\n+/, "");
    } catch {
      // try next
    }
  }
  // Should never happen in deployed envs; keep a tiny fallback so the route
  // can still respond if the file is somehow missing.
  return "Side Quest Generator v4. Generate fun real-world group quests organized by spiciness tier.";
}

const SKILL_BODY = loadSkillBody();

// Kept deliberately compact: this is the cached prefix, so a smaller prompt
// makes even a cache MISS cheap to process. All HARD behavioral + safety rules
// are preserved; only redundant prose, repeated self-checks, and now-obsolete
// output-field rules (group/time ranges are filled server-side) were cut.
const WEBSITE_OVERRIDES = `

---

# WEBSITE OVERRIDES (HARD — take precedence over the skill's output format and any conflicting guidance)

## FOOD BIAS (HARD)
The nearby venue hint is food-dominated; resist it. Max 1 food/eating/drinking quest per batch of 3 — the other 2 must be clearly non-food. Even in non-food quests, never use food/eating/drinking/buying-food as a mechanic, reward, or penalty (no "loser buys coffee"); use "loser picks the next quest", "winner picks the route home", or "group photo as proof" instead.

## NO NAMED VENUES (HARD)
Never put a specific venue, business, restaurant, cafe, bar, street, park, playground, landmark, neighborhood, or institution name in a title or description. Use generic descriptors: "a nearby park", "a local cafe", "a community space". Location is for geographic plausibility only.

## SPICE CEILING (HARD)
Every quest must sit AT OR BELOW the requested spice level. It is a ceiling, not a target.

## PRONOUNS
Match group size: solo → "you"; 2+ → "your crew" / "everyone" / "the group".

## CATEGORY RULES
- Outdoor/Nature: the activity happens outside (parks, trails, streets, fields, water), never inside a business or at a named venue.
- Social/Food: the right home for business/venue-based activities.
- Indoor: done at home/inside, no travel (rearrange furniture and eat there, cook from pantry only, pass-the-controller-on-death).

## SAFETY — HARD BANS (self-check before output)
Default vibe is mild chaos ("could get asked to leave the store" is fine). Ban ONLY these real-harm cases:
1. No library disruption (tag, racing, shouting, "whisper tournaments", scavenger sprints, "stay till staff notices"). Quiet reading/browsing/finding a book is fine.
2. No cart racing with a rider, or cart racing in a crowded area. An empty cart in an empty lot/aisle is fine.
3. Filming/recording strangers: only with their explicit consent, and say so in the quest when strangers are involved. Filming yourselves or consenting strangers is fine.
4. No risky-environment exploration (caves without gear, spelunking, free/mountain/cliff climbing, unmarked trails at night). Normal outdoor activity is fine.
That's the whole ban list. Restaurant-ordering bits, aisle sprints, cashier bits, drive-thru games, parking-lot bits, before-dark navigation — all allowed. The bar is real long-term damage, not "an employee might be annoyed".

## VARIETY (HARD)
Within the batch of 3: at most 1 quest per setting (supermarket/library/restaurant/park/street/etc.), at most 1 per "trick" (sprint/identical-order/backwards-walking/etc.), each a different verb and ideally a different group dynamic (competitive/cooperative/secret/public). The venue-type hint is a SOFT nudge — do not put all 3 at the dominant type.

## OUTPUT FORMAT (overrides the skill's prose format)
Return ONLY a minified JSON array of exactly 3 objects — no whitespace, no markdown, no commentary. Each object has EXACTLY these 3 keys and nothing else:
{"title":"5-8 word punchy title","description":"1-2 short sentences, 16 words MAX, concrete + Gen Z + action-forward, no 'don't do X', no writing tasks","category":"Outdoor|Food|Social|Challenge|Culture|Nightlife|Creative|Indoor"}
Brevity is mandatory. Do NOT emit duration, groupSize, spiceLevel, rating, or any other key — those are set server-side. Keep output as small as possible.
`;

const SYSTEM_PROMPT = `You are running as the backend for the Unemployment app's side quest generator. The canonical skill is loaded below from .claude/skills/side-quest-generator/SKILL.md. Follow it, then apply the website-specific overrides at the bottom.

${SKILL_BODY}${WEBSITE_OVERRIDES}`;

// ---------- Helpers ----------

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseDuration(s: unknown): { min: number; max: number } {
  if (typeof s !== "string") return { min: 60, max: 60 };
  const lower = s.toLowerCase();
  const hasHours = /hour|\bhr/.test(lower);
  const hasMinutes = /minute|\bmin/.test(lower);
  const nums = (lower.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length === 0) return { min: 60, max: 60 };
  const factor = hasHours ? 60 : hasMinutes ? 1 : 60;
  const lo = nums[0] * factor;
  const hi = nums.length > 1 ? nums[1] * factor : lo;
  return {
    min: clamp(Math.round(Math.min(lo, hi)), 5, 360),
    max: clamp(Math.round(Math.max(lo, hi)), 5, 360),
  };
}

function parseGroupSizeString(s: unknown): { min: number; max: number } {
  if (typeof s !== "string") return { min: 3, max: 10 };
  const lower = s.toLowerCase().trim();
  if (lower.startsWith("solo") || lower === "1" || lower === "1 person") {
    return { min: 1, max: 1 };
  }
  const nums = (lower.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return { min: 3, max: 10 };
  const lo = nums[0];
  const hi = nums.length > 1 ? nums[1] : lo;
  return {
    min: clamp(Math.min(lo, hi), 1, 20),
    max: clamp(Math.max(lo, hi), 1, 20),
  };
}

function makeId(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "quest";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

function normalize(
  q: ClaudeQuest,
  excludeIds: Set<string>,
  categoryOverride: QuestCategory | null,
  defaults: {
    spice: number;
    time: { min: number; max: number };
    group: { min: number; max: number };
  },
): GeneratedQuest | null {
  if (!q || typeof q.title !== "string" || typeof q.description !== "string") {
    return null;
  }
  const v4Cat = isV4Category(q.category) ? q.category : null;
  const inferredCategory: QuestCategory = v4Cat
    ? V4_TO_QUEST_CATEGORY[v4Cat]
    : "Social";
  const category: QuestCategory = categoryOverride ?? inferredCategory;
  // Spice/time/group come from the user's request (the spice value is also the
  // ceiling). Fall back to the model's fields only if it still emits them.
  const spice = clamp(
    Math.round(Number(q.spiceLevel) || defaults.spice),
    1,
    defaults.spice,
  );
  const time = q.duration ? parseDuration(q.duration) : defaults.time;
  const group = q.groupSize ? parseGroupSizeString(q.groupSize) : defaults.group;
  const minTime = time.min;
  const maxTime =
    time.min === time.max ? Math.min(360, time.min + 30) : time.max;
  const minGroup = group.min;
  const maxGroup =
    group.min === group.max && group.max > 1
      ? Math.min(20, group.min + 2)
      : group.max;

  let id = (typeof q.id === "string" && q.id.trim()) || makeId(q.title);
  if (excludeIds.has(id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 7)}`;
  }
  excludeIds.add(id);

  return {
    id,
    title: q.title.trim(),
    description: q.description.trim(),
    category,
    spice,
    minGroup,
    maxGroup,
    minTime,
    maxTime,
    nearbyDetected: false,
  };
}

// ---------- Histogram + few-shot ----------

const TYPE_LABELS: Record<string, string> = {
  restaurant: "restaurants",
  fast_food: "fast food spots",
  cafe: "cafes",
  bar: "bars",
  cinema: "cinemas",
  theatre: "theatres",
  library: "libraries",
  gym: "gyms",
  park: "parks",
  playground: "playgrounds",
  sports_centre: "sports centres",
  stadium: "stadiums",
  museum: "museums",
  attraction: "attractions",
  viewpoint: "viewpoints",
  supermarket: "supermarkets",
  mall: "malls",
  hardware: "hardware stores",
};

/**
 * Build the histogram string from the capped typeCounts returned by
 * /api/nearby-places. Source of truth is the capped counts — we do NOT
 * recount from raw place objects here.
 */
function buildHistogram(typeCounts: Record<string, number>): string {
  // Soft hint, not an anchor. We:
  //   1. drop the counts entirely (sample size leaks through and over-anchors
  //      the model on whichever bucket "won"),
  //   2. cap at 4 entries instead of 8 so we don't enumerate the whole map,
  //   3. randomize the order of equally-weighted entries so the same query
  //      doesn't always emphasise the same dominant type.
  const labeled: Record<string, number> = {};
  for (const [type, n] of Object.entries(typeCounts)) {
    const label = TYPE_LABELS[type] ?? type;
    labeled[label] = (labeled[label] ?? 0) + n;
  }
  const entries = Object.entries(labeled).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "(no nearby info)";
  // Take top 6, then shuffle the slice so the lead bucket isn't always first.
  const slice = entries.slice(0, 6).map(([label]) => label);
  for (let i = slice.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slice[i], slice[j]] = [slice[j], slice[i]];
  }
  return slice.slice(0, 4).join(", ");
}

// ---------- Diversity axes ----------
//
// Soft prompt-side diversity seed: 4 axes, each picked from a small pool per
// request. We tell the model "use AT LEAST ONE per quest and span 3+ axes
// across the batch", which steers each batch away from the
// "supermarket sprint" attractor without hard-filtering the space.

const DIVERSITY_AXES = {
  verb: [
    "invent",
    "trade",
    "map",
    "teach",
    "sketch",
    "cook",
    "hide",
    "race",
    "collect",
    "photograph",
    "interview",
    "decode",
    "build",
    "perform",
    "barter",
    "swap",
    "stargaze",
    "skip-stones",
    "deliver",
  ],
  setting: [
    "indoors",
    "outdoors",
    "residential",
    "commercial",
    "natural",
    "transit",
    "civic",
    "rooftop",
  ],
  prop: [
    "phone-banned",
    "paper-only",
    "food-based",
    "chalk",
    "cash-only",
    "one-shared-item",
    "no-props",
    "music",
    "polaroid",
    "balloon",
  ],
  group_dynamic: [
    "competitive",
    "cooperative",
    "secret",
    "public",
    "relay",
    "silent",
    "narrated",
    "timed",
    "open-ended",
  ],
} as const;

type DiversitySeed = {
  verb: string;
  setting: string;
  prop: string;
  group_dynamic: string;
};

// ---------- Recent-vibe detection ----------
//
// Bucket previousTitles into coarse "vibe" categories so pickDiversitySeed
// can steer away from what the user just saw. Keyword sets per the spec.

type VibeBucket = "food" | "outdoor" | "retail" | "indoor";

const VIBE_KEYWORDS: Record<VibeBucket, string[]> = {
  food: [
    "diner",
    "food",
    "eat",
    "restaurant",
    "coffee",
    "cook",
    "breakfast",
    "lunch",
    "dinner",
    "snack",
    "burger",
    "pizza",
    "taco",
    "drink",
    "fast food",
    "drive-through",
    "cook-off",
    "menu",
  ],
  outdoor: [
    "park",
    "hike",
    "sunrise",
    "trail",
    "lake",
    "river",
    "hill",
    "nature",
    "outside",
    "drive",
    "viewpoint",
  ],
  retail: [
    "walmart",
    "target",
    "ikea",
    "store",
    "mall",
    "costco",
    "home depot",
    "aisle",
    "register",
    "employee",
    "supermarket",
    "grocery",
    "checkout",
    "produce aisle",
    "deli counter",
  ],
  indoor: ["home", "couch", "living room", "inside", "apartment", "kitchen"],
};

function detectRecentBuckets(previousTitles: string[]): Set<VibeBucket> {
  const buckets = new Set<VibeBucket>();
  if (!previousTitles.length) return buckets;
  const hay = previousTitles.join("  ").toLowerCase();
  (Object.keys(VIBE_KEYWORDS) as VibeBucket[]).forEach((b) => {
    if (VIBE_KEYWORDS[b].some((kw) => hay.includes(kw))) buckets.add(b);
  });
  return buckets;
}

// Map each axis option to the vibe bucket it would reinforce. Options not
// in a map have no strong affinity and are always eligible.
const VERB_VIBE: Partial<Record<string, VibeBucket>> = {
  cook: "food",
  barter: "retail",
  swap: "retail",
  trade: "retail",
  deliver: "retail",
  race: "outdoor",
  stargaze: "outdoor",
  "skip-stones": "outdoor",
  photograph: "outdoor",
};

const SETTING_VIBE: Partial<Record<string, VibeBucket>> = {
  outdoors: "outdoor",
  natural: "outdoor",
  rooftop: "outdoor",
  indoors: "indoor",
  residential: "indoor",
  commercial: "retail",
};

const PROP_VIBE: Partial<Record<string, VibeBucket>> = {
  "food-based": "food",
};

function pickAxis<T extends string>(
  pool: readonly T[],
  vibeMap: Partial<Record<string, VibeBucket>>,
  avoid: Set<VibeBucket>,
): T {
  const eligible = pool.filter((opt) => {
    const v = vibeMap[opt];
    return !v || !avoid.has(v);
  });
  const source = eligible.length > 0 ? eligible : pool;
  return source[Math.floor(Math.random() * source.length)];
}

function pickDiversitySeed(previousTitles: string[]): DiversitySeed {
  const avoid = detectRecentBuckets(previousTitles);
  return {
    verb: pickAxis(DIVERSITY_AXES.verb, VERB_VIBE, avoid),
    setting: pickAxis(DIVERSITY_AXES.setting, SETTING_VIBE, avoid),
    prop: pickAxis(DIVERSITY_AXES.prop, PROP_VIBE, avoid),
    // group_dynamic has no strong vibe affinity — always uniform random.
    group_dynamic:
      DIVERSITY_AXES.group_dynamic[
        Math.floor(Math.random() * DIVERSITY_AXES.group_dynamic.length)
      ],
  };
}

function renderDiversitySeed(seed: DiversitySeed): string {
  return `\n\nDIVERSITY SEED (use at least one tag per quest; the batch should collectively touch 3+ of these 4 axes):
- verb hint: ${seed.verb}
- setting hint: ${seed.setting}
- prop / constraint hint: ${seed.prop}
- group dynamic hint: ${seed.group_dynamic}`;
}

// ---------- Few-shot gold examples ----------
//
// Hand-picked exemplars of the SKILL.md philosophy, two per spiciness tier.
// We grouped by tiers 1–3 / 4–6 / 7–10 so picker tiers cleanly match the
// user's spice slider. These are intentionally inline (not pulled from any
// template library) so the prompt is grounded in known-good shapes.

type FewShotExample = {
  title: string;
  description: string;
  spice: number;
};

const FEW_SHOT_GOLD: { tier: 1 | 2 | 3; examples: FewShotExample[] }[] = [
  {
    tier: 1,
    examples: [
      {
        title: "Highest Point Before Sunrise",
        description:
          "Race in pairs, no GPS, to the highest nearby spot before sunrise. Watch it together.",
        spice: 2,
      },
      {
        title: "24-Hour Diner at 1am",
        description:
          "Hit a 24-hour diner at 1am. Order only coffee and something new. Stay till breakfast.",
        spice: 2,
      },
    ],
  },
  {
    tier: 2,
    examples: [
      {
        title: "Bowling Loser Cooks",
        description:
          "One game, one rule: lowest score cooks the whole crew breakfast tomorrow. No handicaps.",
        spice: 5,
      },
      {
        title: "IKEA Fake Couples",
        description:
          "Pair off as couples furnishing your first home. Ask three employees which sectional says 'young love.'",
        spice: 5,
      },
    ],
  },
  {
    tier: 3,
    examples: [
      {
        title: "Walmart Pickle Oil",
        description:
          "Whole crew enters Walmart, buys exactly three pickles and one baby oil — nothing else. All at the register.",
        spice: 8,
      },
      {
        title: "Home Depot Fake Emergency",
        description:
          "Generate an absurd fake home-emergency photo, show an employee, ask serious repair advice. Don't break character.",
        spice: 8,
      },
    ],
  },
];

function fewShotTier(spice: number): 1 | 2 | 3 {
  if (spice <= 3) return 1;
  if (spice <= 6) return 2;
  return 3;
}

function pickFewShot(userSpice: number): FewShotExample[] {
  const t = fewShotTier(userSpice);
  const entry = FEW_SHOT_GOLD.find((g) => g.tier === t);
  return entry ? entry.examples.slice() : [];
}

// Negative examples teach the model the shape of generic, off-brand quests
// it should NOT emit. Injected after the gold few-shot so the model has the
// good→bad ordering fresh in context.
const NEGATIVE_EXAMPLES = `

AVOID quests like these — they are generic, boring, or off-brand:
- "Draw chalk art on the sidewalk" — solitary, no stakes, no group dynamic
- "Go to a coffee shop and try something new" — food bias, zero adventure
- "Walk in the park and count birds" — no social element, no story
- "Visit a museum and pick a favorite exhibit" — tourist activity, not a side quest
- "Try a new restaurant downtown" — food again, no creativity required`;

function renderFewShot(examples: FewShotExample[]): string {
  if (examples.length === 0) return "";
  const lines = examples
    .map((q, i) => `${i + 1}. ${q.title} — ${q.description}`)
    .join("\n");
  return `\n\nExamples of the quality and STYLE we want (do NOT copy verbatim, match the shape and energy):\n${lines}\n\nNotice these examples are intrinsically fun without naming specific real venues. They use generic anchors like "a 24-hour diner" not "Joe's Diner." Match this style.`;
}

// ---------- Food-bias post-check ----------
//
// Stricter keyword-based food detector that runs as a final pass after the
// regular validator loop. The skill's "max 1 food per batch" rule is hard,
// so when the existing belt fails we retry the model ONCE with an explicit
// food-bias correction message before giving up.

const FOOD_KEYWORDS = [
  "restaurant",
  "cafe",
  "coffee",
  "food",
  "eat",
  "diner",
  "burger",
  "pizza",
  "taco",
  "snack",
  "breakfast",
  "lunch",
  "dinner",
  "drink",
  "bar",
  "pub",
  "brewery",
  "sushi",
  "dessert",
  "ice cream",
  "menu",
  "order food",
  "drive-thru",
  "fast food",
  "cook-off",
  "cook off",
  "drive-through",
  "takeout",
  "take-out",
  "meal",
  "brunch",
  "cuisine",
];

function isFoodQuest(quest: ClaudeQuest): boolean {
  // isFoodQuest check order: (1) category field, (2) title keywords, (3) description keywords
  if ((quest.category ?? "") === "Food") return true;
  const text = `${quest.title ?? ""} ${quest.description ?? ""}`.toLowerCase();
  return FOOD_KEYWORDS.some((kw) => text.includes(kw));
}

// ---------- Validator ----------

const FOOD_VERBS =
  /\b(eat|eats|eating|ate|order|orders|ordered|taste|tastes|tasted|drink|drinks|drank|sandwich|coffee|sushi|wing|wings|popcorn|sample|samples|sampled|snack|snacks|meal|brunch|breakfast|lunch|dinner|dessert)\b/i;

// Server-side safety belt — matches the 4 narrowed hard bans from the
// prompt. Belt and suspenders: the prompt asks the model to self-check,
// this catches drafts that slip through. Title + description are joined
// before the match so single-field bans still trigger.
//
// Two patterns have allow-phrase post-checks:
//   * cart racing is allowed when the haystack also describes an empty
//     cart in an empty area (the spec's whitelist phrasing),
//   * filming/recording a stranger is allowed when the description
//     includes explicit consent language.
// A pattern with an `allow` callback only fires a violation when the
// regex matches AND `allow(haystack)` returns false.
type SafetyRule = {
  name: string;
  regex: RegExp;
  allow?: (haystack: string) => boolean;
};

const EMPTY_CART_ALLOW =
  /(open area|empty lot|no one around|nobody around|empty aisle|empty parking lot)/i;
const CONSENT_ALLOW =
  /(with their consent|if they agree|ask(?:ed)? first|with permission|get(?:s|ting)? permission|if they(?:'re| are) cool with it|only if they say yes|opt[- ]?in)/i;

const SAFETY_RULES: SafetyRule[] = [
  {
    name: "library_disruption",
    regex:
      /library.{0,40}(sprint|race|tag|chase|shout|scream|loud|whisper.{0,20}tournament|until staff)/i,
  },
  {
    name: "cart_racing",
    regex: /cart.{0,20}(rider|racing|race|speed.?run)/i,
    allow: (h) => /empty cart/i.test(h) && EMPTY_CART_ALLOW.test(h),
  },
  {
    name: "risky_terrain",
    regex:
      /(cave(?! painting)|spelunk|free.?climb|mountain.?climb|cliff.{0,20}scramble|unmarked trail.{0,30}night)/i,
  },
  {
    name: "filming_stranger_without_consent",
    regex:
      /(film(?:ing)?|record(?:ing)?)\s+(?:a\s+|the\s+|any\s+|random\s+|some\s+|each\s+)?stranger/i,
    allow: (h) => CONSENT_ALLOW.test(h),
  },
];

function findSafetyViolation(
  haystack: string,
): { name: string; match: string } | null {
  for (const rule of SAFETY_RULES) {
    const m = haystack.match(rule.regex);
    if (!m) continue;
    if (rule.allow && rule.allow(haystack)) continue;
    return { name: rule.name, match: m[0] };
  }
  return null;
}

// Title-bigram Jaccard. We normalize, drop punctuation + stopwords-ish
// noise words, then build the bigram set. A perfect match returns 1.0;
// disjoint returns 0.0.
const TITLE_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "in",
  "at",
  "on",
  "and",
  "or",
  "for",
  "with",
  "by",
]);

function titleBigrams(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLE_STOPWORDS.has(t));
  const out = new Set<string>();
  for (let i = 0; i + 1 < tokens.length; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

function bigramJaccard(a: string, b: string): number {
  const sa = titleBigrams(a);
  const sb = titleBigrams(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  sa.forEach((t) => {
    if (sb.has(t)) inter++;
  });
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const SIMILARITY_THRESHOLD = 0.45;
const SAFETY_LOG = process.env.GENERATE_DEBUG === "1";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shareThreeConsecutive(a: string, b: string): boolean {
  const ta = a.toLowerCase().split(/\s+/).filter(Boolean);
  const tb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (ta.length < 3 || tb.length < 3) return false;
  const trigramsB = new Set<string>();
  for (let i = 0; i + 2 < tb.length; i++) {
    trigramsB.add(`${tb[i]} ${tb[i + 1]} ${tb[i + 2]}`);
  }
  for (let i = 0; i + 2 < ta.length; i++) {
    if (trigramsB.has(`${ta[i]} ${ta[i + 1]} ${ta[i + 2]}`)) return true;
  }
  return false;
}

type ViolationReport = {
  violations: string[];
  leakedNames: string[];
};

function detectViolations(
  quests: ClaudeQuest[],
  rawNames: string[],
  userRequestedSpice: number,
  requestedCategory: string | null,
  previousTitles: string[],
): ViolationReport {
  const violations: string[] = [];
  const leakedNames = new Set<string>();
  let foodCount = 0;

  for (const q of quests) {
    const haystack = `${q.title ?? ""} ${q.description ?? ""}`;
    // Venue leak
    for (const name of rawNames) {
      if (name.length < 3) continue;
      const re = new RegExp(`\\b${escapeRegex(name)}\\b`, "i");
      if (re.test(haystack)) {
        const cat = (q.category ?? "").toLowerCase();
        if (cat !== "food") {
          violations.push(`VIOLATION_VENUE: "${name}" appears in "${q.title}"`);
          leakedNames.add(name);
        }
      }
    }
    // HARD BANS — server-side belt for the 4 narrowed safety patterns.
    const safety = findSafetyViolation(haystack);
    if (safety) {
      violations.push(
        `VIOLATION_SAFETY[${safety.name}]: "${safety.match}" in "${q.title}"`,
      );
    }
    // Food density
    const isFoodCat = (q.category ?? "").toLowerCase() === "food";
    if (isFoodCat || FOOD_VERBS.test(haystack)) foodCount++;
    // Spice delta
    const spice = Number(q.spiceLevel);
    if (!isNaN(spice) && Math.abs(spice - userRequestedSpice) > 2) {
      violations.push(
        `VIOLATION_SPICE: quest spice ${spice} vs user ${userRequestedSpice}`,
      );
    }
  }

  if (
    foodCount > 1 &&
    (!requestedCategory || requestedCategory.toLowerCase() !== "food")
  ) {
    violations.push(`VIOLATION_FOODHEAVY: ${foodCount} food-flavored quests in batch`);
  }

  // Dupe titles — 3-consecutive-word check (existing) PLUS the new bigram
  // Jaccard at 0.45 against (a) sibling titles in this batch and (b) the
  // client-supplied previousTitles list. Catches "Same Trick, Different
  // Wording" cases like "Backwards Navigation Challenge" vs "Reverse Path
  // Challenge" that the trigram check happily lets through.
  for (let i = 0; i < quests.length; i++) {
    const titleI = quests[i].title ?? "";
    for (let j = i + 1; j < quests.length; j++) {
      const titleJ = quests[j].title ?? "";
      if (shareThreeConsecutive(titleI, titleJ)) {
        violations.push(
          `VIOLATION_DUPE: titles "${titleI}" / "${titleJ}"`,
        );
      }
      const j2 = bigramJaccard(titleI, titleJ);
      if (j2 >= SIMILARITY_THRESHOLD) {
        violations.push(
          `VIOLATION_SIMILAR: jaccard=${j2.toFixed(2)} between "${titleI}" / "${titleJ}"`,
        );
      }
    }
    for (const prev of previousTitles) {
      const jp = bigramJaccard(titleI, prev);
      if (jp >= SIMILARITY_THRESHOLD) {
        violations.push(
          `VIOLATION_SIMILAR_PREV: jaccard=${jp.toFixed(2)} between "${titleI}" / "${prev}"`,
        );
      }
    }
  }

  if (SAFETY_LOG && violations.length > 0) {
    console.log("[generate] violations", violations);
  }

  return { violations, leakedNames: Array.from(leakedNames) };
}

// ---------- Scrub ----------

function placeholderForType(osmType: string): string {
  if (["fast_food", "restaurant", "cafe", "bar"].includes(osmType))
    return "a nearby spot";
  if (osmType === "park") return "a nearby park";
  if (osmType === "playground") return "a local playground";
  if (osmType === "sports_centre") return "a nearby sports centre";
  if (osmType === "stadium") return "a nearby stadium";
  if (osmType === "viewpoint") return "a nearby viewpoint";
  if (osmType === "museum") return "a local museum";
  if (osmType === "attraction") return "a nearby attraction";
  if (osmType === "cinema") return "a local cinema";
  if (osmType === "theatre") return "a local theatre";
  if (osmType === "library") return "a local library";
  if (osmType === "gym") return "a nearby gym";
  if (["supermarket", "mall"].includes(osmType)) return "a nearby store";
  if (osmType === "hardware") return "a hardware store";
  return "a nearby spot";
}

function scrub(
  quests: ClaudeQuest[],
  places: Array<Pick<NearbyPlace, "name" | "type">>,
): void {
  for (const q of quests) {
    for (const place of places) {
      if (!place.name || place.name.length < 3) continue;
      const re = new RegExp(`\\b${escapeRegex(place.name)}\\b`, "gi");
      const ph = placeholderForType(place.type);
      if (typeof q.title === "string") q.title = q.title.replace(re, ph);
      if (typeof q.description === "string") {
        q.description = q.description.replace(re, ph);
      }
    }
  }
}

// ---------- Handler ----------

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set" },
      { status: 503 },
    );
  }

  // ----- M12.1 reroll gate (runs BEFORE any generation work) -----
  // Free users get FREE_DAILY_REROLLS generations per UTC day. Pro users skip
  // the gate entirely. Anonymous (unauthenticated) requests have no profile to
  // meter against, so they pass through ungated.
  const dateKey = getUtcDateKey();
  // Pass req so mobile Bearer-token requests authenticate (M12.3); the web app
  // still uses cookie auth because createClient prefers a cookie session.
  const supabase = createClient(req);
  const {
    data: { user: gateUser },
  } = await supabase.auth.getUser();
  let meterFreeUser = false;
  // Surfaced in the success response (M12.3) so the mobile UI can render the
  // tier chip + reroll count without a second round-trip.
  let responseTier: "free" | "pro" = "free";
  if (gateUser) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier, tier_expires_at, daily_rerolls")
      .eq("id", gateUser.id)
      .maybeSingle();
    responseTier = profile?.tier === "pro" ? "pro" : "free";
    const isPro =
      profile?.tier === "pro" &&
      (!profile.tier_expires_at ||
        new Date(profile.tier_expires_at).getTime() > Date.now());
    if (!isPro) {
      meterFreeUser = true;
      const used = profile?.daily_rerolls?.[dateKey] ?? 0;
      if (used >= FREE_DAILY_REROLLS) {
        return NextResponse.json(
          {
            error: "reroll_limit",
            requiresUpgrade: true,
            rerollsToday: used,
            resetAt: "midnight UTC",
          },
          { status: 402 },
        );
      }
    }
  }

  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const location = (body.location ?? "").trim() || "your area";
  // Region is a coarse locale descriptor for geographic plausibility only.
  // Prefer the geocoded region; fall back to the raw location string so the
  // model always has *some* locale signal (the raw city is enough to avoid
  // "surf in landlocked Arizona" style misfires).
  const region = (body.region ?? "").trim() || location;
  const places = Array.isArray(body.nearbyPlaces)
    ? body.nearbyPlaces
        .filter((p) => p && typeof p.name === "string" && typeof p.type === "string")
        .slice(0, 20)
    : [];
  // Histogram is built from the pre-capped typeCounts the place-fetch route
  // computed. If the client didn't send it, derive a fallback from places
  // (which are already capped by /api/nearby-places).
  const typeCounts: Record<string, number> =
    body.typeCounts && typeof body.typeCounts === "object"
      ? body.typeCounts
      : (() => {
          const tc: Record<string, number> = {};
          for (const p of places) tc[p.type] = (tc[p.type] ?? 0) + 1;
          return tc;
        })();
  const spiceLevel = clamp(Math.round(Number(body.spiceLevel) || 5), 1, 10);
  const groupSize: GroupSizeBand =
    body.groupSize === "solo" || body.groupSize === "2" || body.groupSize === "group"
      ? body.groupSize
      : "group";
  const timeAvailable = clamp(Math.round(Number(body.timeAvailable) || 90), 5, 360);
  const excludeIds = Array.isArray(body.excludeIds)
    ? body.excludeIds.slice(0, 200)
    : [];
  const previousTitles = Array.isArray(body.previousTitles)
    ? body.previousTitles.filter((t) => typeof t === "string").slice(-9)
    : [];
  const categoryRaw =
    typeof body.category === "string" ? body.category.trim() : "";
  const requestedCategory =
    categoryRaw && categoryRaw.toLowerCase() !== "all" ? categoryRaw : null;
  const canDrive = body.canDrive !== false;
  const lowCostOnly = body.lowCostOnly === true;

  const groupSizeHint =
    groupSize === "solo"
      ? "1 person"
      : groupSize === "2"
        ? "2 people"
        : "3+ people";
  const previousStr = previousTitles.length
    ? `\n\nBANNED TITLES — do NOT generate any quest with a title that closely matches these (exact or near-paraphrase):\n${previousTitles.join("\n")}\n\nGenerating a banned title is a failure. Treat this list as a blocklist, not a suggestion.`
    : "";
  const categoryPrefix = requestedCategory
    ? `Generate quests in the ${requestedCategory} category. `
    : "";
  const driveStr = canDrive ? "" : " Constraint: walking distance only, no car.";
  const costStr = lowCostOnly
    ? " Constraint: free or very low cost only — each quest must cost under $5 per person, ideally $0. No paid venues, ticketed events, or quests that require any meaningful purchase."
    : "";
  const histogram = buildHistogram(typeCounts);
  const fewShot = pickFewShot(spiceLevel);
  const fewShotStr = renderFewShot(fewShot);
  const diversitySeed = pickDiversitySeed(previousTitles);
  const diversityStr = renderDiversitySeed(diversitySeed);

  const baseUserMessage = `${categoryPrefix}Generate exactly 3 side quests. Light context: the user is in ${region} (atmosphere only — NOT a venue list to draw from).

GEOGRAPHIC PLAUSIBILITY: Use "${region}" only to keep quests physically possible for the area's climate, terrain, and density — e.g. no surfing/tide-pools in a landlocked region, no "hit 30 bars in an hour" in a rural town, no ski quests in a desert. Do NOT name any specific venue, street, or landmark; this is a sanity check on quest TYPE, not a place to drop proper nouns.${fewShotStr}${NEGATIVE_EXAMPLES}

Venue TYPES available nearby (soft hint only — do NOT make all 3 quests at the dominant type): ${histogram}

For example, if they have parks, your quest can say "a nearby park" — do NOT name the park.${diversityStr}

Inputs: spice level ${spiceLevel}/10, group size ${groupSizeHint}, time available ${timeAvailable} minutes.${driveStr}${costStr}${previousStr}

HARD CONSTRAINT: Generate at most 1 food-related quest (category Food, or activities centered on eating/drinking at a venue). If nearby venues are food-heavy, still find non-food angles.

Return ONLY a minified JSON array of EXACTLY 3 objects in the slim OUTPUT FORMAT from the system prompt — keys title/description/category only, each description 16 words MAX. No markdown, no whitespace, no commentary.`;

  const rawNames = places.map((p) => p.name);
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // The extended (1h) prompt-cache TTL is only honored when this beta header
    // is on the ACTUAL HTTP request. Setting it as a client default guarantees
    // it ships on every call — a per-request header is easy to get silently
    // wrong, and without it the API falls back to the default 5m TTL.
    defaultHeaders: { "anthropic-beta": "extended-cache-ttl-2025-04-11" },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  // Multi-turn conversation so retries can append assistant + corrective user.
  type Msg = { role: "user" | "assistant"; content: string };
  const messages: Msg[] = [{ role: "user", content: baseUserMessage }];

  let lastParsed: ClaudeQuest[] | null = null;
  let lastViolations: string[] = [];
  const MAX_RETRIES = 2;

  // Per-stage timing — mirrors the [nearby-places] breakdown so before/after
  // p95 work can be measured rather than guessed. `llmUsage` captures the
  // per-call token accounting (incl. cache_read vs cache_creation) so we can
  // confirm prompt caching is actually being HIT.
  const llmStageMs: number[] = [];
  const llmUsage: Array<Record<string, number | undefined>> = [];
  // Retained in the timing log for continuity; the food top-up call was
  // removed (it doubled p95), so this stays 0.
  const topupMs = 0;

  function recordUsage(u: Anthropic.Messages.Usage | undefined): void {
    if (!u) return;
    const read = u.cache_read_input_tokens ?? 0;
    const create = u.cache_creation_input_tokens ?? 0;
    const create1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const create5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    // HIT = the cached prefix was read; MISS = we re-paid to (re)create it.
    const cacheHit = read > 0 && create === 0;
    llmUsage.push({
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: read,
      cacheCreate: create,
      create1h,
      create5m,
      cacheHit: cacheHit ? 1 : 0,
    });
    // One-glance regime read in the Vercel function logs: scan a handful of
    // these and the hit fraction is immediately obvious. create1h > 0 on a
    // miss confirms the 1h extended TTL is actually being applied.
    console.log("[generate] cache", {
      hit: cacheHit,
      read,
      create,
      create1h,
      create5m,
      // Raw breakdown straight from the API — if a MISS shows create1h>0 the
      // extended TTL is on the wire; if it only ever shows 5m, the beta header
      // isn't being applied.
      raw: u.cache_creation,
      output: u.output_tokens,
    });
  }

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // When the category is locked, the model's distribution narrows hard
      // and we see the same handful of templates remixed across rerolls.
      // 3 quests need ~750 output tokens. We hold both branches at 0.75 —
      // higher temperatures were biasing toward JSON schema drift and the
      // category-locked branch never actually benefited from the bump in
      // practice.
      const temperature = 0.75;
      const llmStart = Date.now();
      const response = await client.messages.create(
        {
          model: "claude-haiku-4-5",
          // Output generation is the single biggest latency term for the one
          // call we make. With the slim 3-key schema + 16-word descriptions,
          // 3 quests fit in ~180-220 tokens; 384 is a hard backstop that
          // bounds the tail without truncating valid minified JSON.
          max_tokens: 384,
          temperature,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              // 1h extended TTL (vs the default 5m) so the cached system
              // prompt survives between spaced-out rerolls and across lambda
              // instances — the 5m default kept expiring, which is what made
              // latency bimodal (every few calls re-paid cache_creation).
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
          messages,
        },
        { signal: controller.signal },
      );
      llmStageMs.push(Date.now() - llmStart);
      recordUsage(response.usage);

      const textBlock = response.content.find((b) => b.type === "text");
      const text =
        textBlock && textBlock.type === "text" ? textBlock.text : "";
      if (!text) break;

      let parsed: unknown;
      try {
        parsed = extractJsonArray(text);
      } catch {
        parsed = null;
      }
      if (!Array.isArray(parsed)) break;

      // Cap at the contract size up-front — when the model returns 6
      // (which the Outdoor audit saw) we'd otherwise propagate the extras
      // through to the client. Keeping the first 3 also makes the
      // violation report deterministic.
      const arr = (parsed as ClaudeQuest[]).slice(0, 3);
      const report = detectViolations(
        arr,
        rawNames,
        spiceLevel,
        requestedCategory,
        previousTitles,
      );
      lastParsed = arr;
      lastViolations = report.violations;
      console.log("[generate] attempt", attempt + 1, {
        questCount: arr.length,
        rawNames: rawNames.length,
        violations: report.violations.length,
        violationList: report.violations,
        leaked: report.leakedNames,
      });

      // p95 budget: a full corrective round-trip costs ~2-3s, so we only spend
      // one on violations that post-processing CANNOT repair — i.e. safety
      // bans. Venue leaks are fixed by scrub() below, food-density by the
      // top-up pass, and spice/dupe/similarity are cosmetic; retrying for
      // those was the main driver of the 6.8-10.8s tail. Accept the first
      // draft for everything except a hard safety hit.
      const blocking = report.violations.filter((v) =>
        v.startsWith("VIOLATION_SAFETY"),
      );
      if (blocking.length === 0 || attempt === MAX_RETRIES) break;

      // Append assistant + corrective user, then loop (safety-only).
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `Previous attempt violated a hard safety rule: ${blocking.join("; ")}. Generate 3 NEW quests that fix this. Keep everything else (no named venues, max 1 food quest, spice ceiling).`,
      });
    }

    clearTimeout(timer);

    if (!lastParsed) {
      return NextResponse.json(
        { ok: false, error: "no valid model output" },
        { status: 503 },
      );
    }

    // ---------- Food-bias post-check + smart top-up ----------
    //
    // Old behavior: a full second 3-quest regeneration whenever food count
    // ≥ 2 — doubled tail latency in the worst case. New: keep at most one
    // food quest, filter the rest, and only request the missing N quests
    // with a tiny max_tokens ceiling. Strictly faster end-to-end (smaller
    // prompt, smaller completion) and we never throw away the good non-food
    // quests we already had.
    const foodCheckUserRequested =
      requestedCategory && requestedCategory.toLowerCase() === "food";
    if (!foodCheckUserRequested) {
      // p95: a food-heavy batch no longer triggers a second LLM round-trip.
      // The old top-up fired a full extra Haiku call whenever >=2 quests
      // looked food-related — and isFoodQuest is broad (bar/drink/cook/menu/
      // meal...), so on a restaurant-dense city it false-positived and
      // roughly DOUBLED latency on nearly every reroll. The single-call
      // prompt already pushes hard for "max 1 food per batch"; we just log
      // slips and ship the 3 quests we have instead of paying ~2-3s to
      // regenerate.
      const foodCount = lastParsed.filter(isFoodQuest).length;
      if (foodCount >= 2) {
        console.log("[generate] food-bias slip (accepted, no top-up)", {
          foodCount,
        });
      }
    }

    // Final-pass server-side scrub if violations remained after retries.
    if (lastViolations.length > 0) {
      scrub(lastParsed, places);
    }

    const seen = new Set(excludeIds);
    const categoryOverride: QuestCategory | null =
      requestedCategory && isUiCategory(requestedCategory)
        ? requestedCategory
        : null;
    // Defaults derived from the user's own request — used to fill the fields
    // we no longer ask the model to emit (keeps output tokens minimal).
    const groupRange =
      groupSize === "solo"
        ? { min: 1, max: 3 }
        : groupSize === "2"
          ? { min: 2, max: 4 }
          : { min: 3, max: 6 };
    const tMin = clamp(Math.round(timeAvailable * 0.6), 5, 345);
    const tMax = clamp(Math.max(timeAvailable, tMin + 15), 5, 360);
    const normalizeDefaults = {
      spice: spiceLevel,
      time: { min: tMin, max: tMax },
      group: groupRange,
    };
    const quests: GeneratedQuest[] = [];
    for (const item of lastParsed) {
      const normalized = normalize(item, seen, categoryOverride, normalizeDefaults);
      if (normalized) quests.push(normalized);
    }

    if (quests.length === 0) {
      return NextResponse.json(
        { ok: false, error: "no valid quests" },
        { status: 503 },
      );
    }

    // Charge the reroll only once a generation actually succeeded. Atomic
    // jsonb_set inside the RPC — never a read-then-write here. The RPC returns
    // the post-increment count, which feeds rerollsRemaining below.
    // rerollsRemaining is a number for metered free users, null for pro and
    // anonymous callers.
    let rerollsRemaining: number | null = null;
    if (meterFreeUser) {
      const { data: newCount } = await supabase.rpc(
        "increment_daily_reroll",
        { p_date_key: dateKey },
      );
      rerollsRemaining = Math.max(
        0,
        FREE_DAILY_REROLLS - (typeof newCount === "number" ? newCount : 0),
      );
    }

    console.log("[generate] timing", {
      llmStageMs,
      llmTotalMs: llmStageMs.reduce((a, b) => a + b, 0),
      topupMs,
      attempts: llmStageMs.length,
      // cacheRead > 0 on calls after the first confirms the system prompt is
      // being served from cache rather than re-billed as cache_creation.
      usage: llmUsage,
    });

    // Lightweight quality-review log: the inputs that shaped this batch and the
    // 3 quests we shipped, so the owner can later mine patterns and feed
    // improvements back into the skill. Titles + descriptions only — no PII.
    console.log("[generate] result", {
      location,
      region,
      histogram,
      spiceLevel,
      groupSize,
      category: requestedCategory,
      quests: quests.map((q) => ({
        title: q.title,
        description: q.description,
        category: q.category,
        spice: q.spice,
      })),
    });

    return NextResponse.json({
      ok: true,
      quests,
      tier: responseTier,
      rerollsRemaining,
    });
  } catch (err) {
    clearTimeout(timer);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
