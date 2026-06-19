import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { QuestCategory } from "@/lib/quests";
import { GeneratedQuest } from "@/lib/generate";
import { NearbyBucket, NearbyPlace } from "@/lib/nearby";
import { createClient } from "@/lib/supabase/server";
import { FREE_DAILY_REROLLS, getUtcDateKey } from "@/lib/constants";
import {
  SYSTEM_PROMPT,
  renderTierPointer,
  isFoodQuest,
} from "@/lib/quest-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupSizeBand = "solo" | "2" | "group";

type GenerateBody = {
  location?: string;
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

// v4 schema as returned by the model
type ClaudeQuest = {
  id?: string;
  title: string;
  description: string;
  category: string;
  duration: string; // "1-2 hours", "30 minutes"
  groupSize: string; // "2-4 people", "solo"
  spiceLevel: number;
  rating: null;
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
): GeneratedQuest | null {
  if (!q || typeof q.title !== "string" || typeof q.description !== "string") {
    return null;
  }
  const v4Cat = isV4Category(q.category) ? q.category : null;
  const inferredCategory: QuestCategory = v4Cat
    ? V4_TO_QUEST_CATEGORY[v4Cat]
    : "Social";
  const category: QuestCategory = categoryOverride ?? inferredCategory;
  const spice = clamp(Math.round(Number(q.spiceLevel) || 5), 1, 10);
  const time = parseDuration(q.duration);
  const group = parseGroupSizeString(q.groupSize);
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

// ---------- Food-bias post-check ----------
//
// The few-shot gold set, negative examples, food-keyword list, and isFoodQuest
// detector now live in lib/quest-prompt.ts (single source of truth shared with
// the eval harness). The keyword-based detector runs as a final pass after the
// regular validator loop. The skill's "max 1 food per batch" rule is hard, so
// when the existing belt fails we retry the model ONCE with an explicit
// food-bias correction message before giving up.

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
  // The few-shot gold set + negative examples now live in the cached system
  // prompt; here we only point the model at the tier that matches this spice.
  const tierPointer = renderTierPointer(spiceLevel);
  const diversitySeed = pickDiversitySeed(previousTitles);
  const diversityStr = renderDiversitySeed(diversitySeed);

  const baseUserMessage = `${categoryPrefix}Generate exactly 3 side quests. Light context: the user is in ${location} (atmosphere only — NOT a venue list to draw from).${tierPointer}

Venue TYPES available nearby (soft hint only — do NOT make all 3 quests at the dominant type): ${histogram}

For example, if they have parks, your quest can say "a nearby park" — do NOT name the park.${diversityStr}

Inputs: spice level ${spiceLevel}/10, group size ${groupSizeHint}, time available ${timeAvailable} minutes.${driveStr}${costStr}${previousStr}

HARD CONSTRAINT: Generate at most 1 food-related quest (category Food, or activities centered on eating/drinking at a venue). If nearby venues are food-heavy, still find non-food angles.

Return a JSON array of EXACTLY 3 quest objects following the OUTPUT FORMAT defined in the system prompt. No markdown, no explanation, just the raw JSON array. If you produce more than 3, only the first 3 will be used.`;

  const rawNames = places.map((p) => p.name);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);

  // Multi-turn conversation so retries can append assistant + corrective user.
  type Msg = { role: "user" | "assistant"; content: string };
  const messages: Msg[] = [{ role: "user", content: baseUserMessage }];

  let lastParsed: ClaudeQuest[] | null = null;
  let lastViolations: string[] = [];
  const MAX_RETRIES = 2;

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // When the category is locked, the model's distribution narrows hard
      // and we see the same handful of templates remixed across rerolls.
      // 3 quests need ~750 output tokens. We hold both branches at 0.75 —
      // higher temperatures were biasing toward JSON schema drift and the
      // category-locked branch never actually benefited from the bump in
      // practice.
      const temperature = 0.75;
      const response = await client.messages.create(
        {
          model: "claude-haiku-4-5",
          max_tokens: 900,
          temperature,
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        },
        { signal: controller.signal },
      );

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

      if (report.violations.length === 0 || attempt === MAX_RETRIES) break;

      // Append assistant + corrective user, then loop.
      messages.push({ role: "assistant", content: text });
      const leakList = report.leakedNames.length
        ? ` Specifically avoid these venue names that leaked: ${report.leakedNames.join(", ")}.`
        : "";
      messages.push({
        role: "user",
        content: `Previous attempt violated rules: ${report.violations.join("; ")}. Generate 3 NEW quests fixing these issues.${leakList} Use generic placeholders like "a nearby park", "a local cafe", "a community space".`,
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
      const foodCount = lastParsed.filter(isFoodQuest).length;
      if (foodCount >= 2) {
        const nonFood: ClaudeQuest[] = [];
        let keptFood = 0;
        for (const q of lastParsed) {
          if (isFoodQuest(q)) {
            if (keptFood === 0) {
              nonFood.push(q);
              keptFood = 1;
            }
            // else: drop the excess food quest
          } else {
            nonFood.push(q);
          }
        }
        const needed = 3 - nonFood.length;
        console.log("[generate] food-bias post-check failed", {
          foodCount,
          dropped: needed,
          kept: nonFood.length,
        });

        if (needed > 0) {
          // Top-up call: short prompt, tight max_tokens, no AbortController
          // ceiling so a slow link doesn't bounce a healthy completion.
          try {
            const topupResponse = await client.messages.create({
              model: "claude-haiku-4-5",
              max_tokens: 400,
              temperature: 0.75,
              system: [
                {
                  type: "text",
                  text: SYSTEM_PROMPT,
                  cache_control: { type: "ephemeral" },
                },
              ],
              messages: [
                {
                  role: "user",
                  content: `Generate exactly ${needed} non-food side quest${needed === 1 ? "" : "s"}. Same location (${location}) and spice level (${spiceLevel}/10). JSON array only.`,
                },
              ],
            });
            const topupTextBlock = topupResponse.content.find(
              (b) => b.type === "text",
            );
            const topupText =
              topupTextBlock && topupTextBlock.type === "text"
                ? topupTextBlock.text
                : "";
            let topupParsed: unknown = null;
            try {
              topupParsed = extractJsonArray(topupText);
            } catch {
              topupParsed = null;
            }
            if (Array.isArray(topupParsed)) {
              const topupArr = (topupParsed as ClaudeQuest[])
                .filter((q) => q && typeof q.title === "string")
                .filter((q) => !isFoodQuest(q))
                .slice(0, needed);
              lastParsed = [...nonFood, ...topupArr].slice(0, 3);
              console.log("[generate] food-bias topup", {
                requested: needed,
                received: topupArr.length,
                finalFood: lastParsed.filter(isFoodQuest).length,
              });
              // Re-run violation detection on the merged batch so the scrub
              // below sees an accurate picture.
              const mergedReport = detectViolations(
                lastParsed,
                rawNames,
                spiceLevel,
                requestedCategory,
                previousTitles,
              );
              lastViolations = mergedReport.violations;
            } else {
              // Couldn't parse the top-up — fall back to the trimmed batch
              // (≤2 quests) rather than the original food-heavy one.
              lastParsed = nonFood;
            }
          } catch (err) {
            console.log("[generate] food-bias topup failed", err);
            // Keep the trimmed batch — at minimum we removed the duplicates.
            lastParsed = nonFood;
          }
        }
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
    const quests: GeneratedQuest[] = [];
    for (const item of lastParsed) {
      const normalized = normalize(item, seen, categoryOverride);
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
