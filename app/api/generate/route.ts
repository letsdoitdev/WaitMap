import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { QuestCategory } from "@/lib/quests";
import { GeneratedQuest } from "@/lib/generate";
import { NearbyBucket, NearbyPlace } from "@/lib/nearby";
import { createClient } from "@/lib/supabase/server";
import { FREE_DAILY_REROLLS, getUtcDateKey } from "@/lib/constants";
import { hardFilterQuests, selectTopQuests } from "@/lib/quest-ranker";
import { pickModel } from "@/lib/model-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type GroupSizeBand = "solo" | "2" | "group";

export type GenerateBody = {
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
  /** Onboarding vibe answer (UI category names). Soft taste bias only. */
  vibeCategories?: string[];
  /** 3-value cost preference. Supersedes lowCostOnly when present. */
  costPref?: CostPref;
  /** User's local hour (0-23) + weekday, for temporal plausibility. */
  localHour?: number;
  localWeekday?: string;
};

export type CostPref = "free" | "cheap" | "any";

// Slim schema as returned by the model. To keep output tokens (the dominant
// latency term for a single Haiku call) minimal, the model now returns only
// title/description/category — duration, groupSize and spiceLevel are filled
// server-side from the user's own inputs. The extra fields stay optional so a
// model that still emits them is parsed without error.
export type ClaudeQuest = {
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
export function isUiCategory(s: string): s is QuestCategory {
  return (UI_CATEGORIES as string[]).includes(s);
}
function isV4Category(s: string): boolean {
  return (V4_CATEGORIES as readonly string[]).includes(s);
}

// ---------- Personal-signal sanitizers (M13 quest quality) ----------
//
// Onboarding collects vibes / cost pref / local time but the prompt never saw
// them. All three are client-controlled, so each is validated against a
// whitelist (vibes, weekday) or a closed enum/range (costPref, hour) before it
// can reach the prompt — nothing here interpolates free-form client text.

// The 7 vibe options StepVibe offers, mapped to phrasing in the model's own
// §9 category vocabulary (Chaos→Challenge, Late Night→Nightlife; Chill has no
// V4 category so it's described as the tier-1/2 calm end of the spectrum).
const VIBE_MODEL_HINT: Record<string, string> = {
  Chaos: "high-energy group chaos (Challenge)",
  Outdoor: "outdoor adventures (Outdoor)",
  Social: "social bits involving strangers (Social)",
  Creative: "making things together (Creative)",
  Food: "food-centered outings (Food)",
  "Late Night": "late-night energy (Nightlife)",
  Chill: "calm, wholesome hangs (the chill tier-1 end)",
};

// UI vibe names → the model's §9 category vocabulary, for the ranker's
// vibe-match bonus and exploration slot. Chill maps to no category — it
// describes the calm tier, not a category.
const VIBE_TO_V4: Record<string, string | null> = {
  Chaos: "Challenge",
  Outdoor: "Outdoor",
  Social: "Social",
  Creative: "Creative",
  Food: "Food",
  "Late Night": "Nightlife",
  Chill: null,
};

export function preferredV4Categories(vibes: string[]): Set<string> {
  const out = new Set<string>();
  for (const v of vibes) {
    const c = VIBE_TO_V4[v];
    if (c) out.add(c);
  }
  return out;
}

export function sanitizeVibes(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item in VIBE_MODEL_HINT && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

export function sanitizeCostPref(
  costPref: unknown,
  lowCostOnly: boolean,
): CostPref | null {
  if (costPref === "free" || costPref === "cheap" || costPref === "any") {
    return costPref;
  }
  // Back-compat: older clients only send the boolean.
  return lowCostOnly ? "free" : null;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type LocalTime = { hour: number; weekday: string };

export function sanitizeLocalTime(
  hour: unknown,
  weekday: unknown,
): LocalTime | null {
  const h = Number(hour);
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  const wd = (WEEKDAYS as readonly string[]).includes(weekday as string)
    ? (weekday as string)
    : null;
  if (!wd) return null;
  return { hour: h, weekday: wd };
}

function formatHour12(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? "am" : "pm"}`;
}

/**
 * Region/location strings are client-controlled text interpolated into the
 * prompt (and logged). Nominatim display_names are verbose and can be
 * house-number precise when the user typed a street address. Collapse
 * whitespace, keep at most 3 comma segments — for longer names, the first
 * plus the last two ("Ashburn, Loudoun County, Virginia, United States" →
 * "Ashburn, Virginia, United States"), which drops street-level detail —
 * and cap the length.
 */
export function sanitizeRegion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const segs = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const kept =
    segs.length <= 3 ? segs : [segs[0], ...segs.slice(-2)];
  return kept.join(", ").slice(0, 80);
}

/**
 * typeCounts keys become histogram labels in the prompt. Whitelist the key
 * shape (word characters only — no free-form client text), clamp values,
 * and cap the entry count, keeping known venue types first so an abusive
 * payload can't crowd them out.
 */
export function sanitizeTypeCounts(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const entries = Object.entries(v as Record<string, unknown>).sort(
    ([a], [b]) => Number(b in TYPE_LABELS) - Number(a in TYPE_LABELS),
  );
  const out: Record<string, number> = {};
  for (const [key, val] of entries) {
    if (Object.keys(out).length >= 18) break;
    if (key.length > 30 || !/^[a-z0-9_]+$/i.test(key)) continue;
    const n = Math.floor(Number(val));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = Math.min(n, 500);
  }
  return out;
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

// Static request protocol, appended to the constitution. Two jobs:
//
// 1. It holds every instruction that used to be repeated verbatim in each
//    user message (geographic-plausibility rules, venue-hint semantics,
//    diversity-seed usage, the closing build/score/output paragraph), so the
//    per-request message is only the volatile lines — smaller requests, and
//    identical instructions can never drift between the two endpoints.
// 2. It pushes the cached system prefix past claude-haiku-4-5's 4096-token
//    minimum cacheable prompt length. The constitution alone is ~3.6K
//    tokens, UNDER the minimum — cache_control silently no-oped, every call
//    re-paid full input processing, and the 1h-TTL beta header did nothing.
//    Verify post-deploy via the [generate] cache log: the second request
//    within the TTL must show cacheRead > 0. If it's still 0, this block
//    needs to grow.
const REQUEST_PROTOCOL = `
---

# WEBSITE REQUEST PROTOCOL (server context lines)

You are generating for the WaitMap web/mobile app. Each request supplies compact context lines. Interpret each line exactly as specified below, then construct the batch per the constitution above. Everything in this section restates or applies the constitution — nothing here relaxes a hard rule from §5, §7, or §8.

**Task.** Construct exactly 3 side quests per request — unless the request explicitly asks for a different count, in which case produce exactly that many. Build each quest from a DIFFERENT §6 structural template (different setting and different verb), score each against the §4 rubric, and reject any §5 anti-structure before emitting. Output EXACTLY per the §9 FORMAT ANCHOR: a minified JSON array with one object per quest, keys title/description/category only, each description 10-14 words (16 ABSOLUTE MAX). No markdown fences, no commentary, no whitespace padding.

**"Construct N quests."** (optional first line) — produce exactly N objects in the array instead of 3. All other rules hold at batch scale: still at most 1 food-flavored quest in the whole batch, never repeat a §6 template within the batch, and when N is 6 spread the batch across at least 4 different categories (unless a single category was requested). The server ranks and ships the best 3, so N distinct, rule-clean candidates beat N variations of one idea.

**"Generate quests in the X category."** (optional first line) — a deliberate user filter. Every quest in the batch should land in or near that category; the 3-different-categories spread rule is suspended for that request. The spice ceiling, anti-food rule, and all safety bans still apply.

**"Region:"** — geographic plausibility ONLY. Use it to keep quests physically possible for the area's climate, terrain, and density: no surfing or tide-pools in a landlocked region, no "hit 30 bars in an hour" in a rural town, no ski quests in a desert, no subway quests where there is no subway. It is atmosphere, NOT a venue list — never name a specific venue, street, park, landmark, or neighborhood from it or from your own knowledge of the area.

**"Venue types nearby:"** — a soft, generic hint about what kinds of places exist near the user (drawn from: restaurants, fast food spots, cafes, bars, cinemas, theatres, libraries, gyms, parks, playgrounds, sports centres, stadiums, museums, attractions, viewpoints, supermarkets, malls, hardware stores). Do NOT set every quest at the dominant type, and remember the anti-food rule: the hint list skews food-heavy; resist it. If parks are listed, a quest may say "a nearby park" — never a park's name. "(no nearby info)" means no venue data — lean on settings that exist everywhere (streets, homes, open spaces).

**"DIVERSITY SEED:"** — four axis hints (verb / setting / prop or constraint / group dynamic). Use at least one tag per quest, and make the batch collectively touch at least 3 of the 4 axes. The seed exists to pull batches out of repetitive attractors; treat it as creative fuel, not a checklist to name-drop.

**"Vibe lean:"** (optional) — the user's standing taste from onboarding. Favor these vibes in roughly two-thirds of the batch, but do NOT exclude other categories — the batch must still span at least 3 different categories. A vibe lean is a lean; variety within it is still the point.

**"Local context:"** (optional) — the user's current weekday and approximate local hour. Keep every quest temporally plausible for that hour: no sunrise missions at 11pm, no "watch the sunset" at noon, Nightlife energy belongs to evenings and late nights, quiet tier-1 rituals fit early mornings and weekday nights. Let the hour and weekday steer category choice per §7.

**"Inputs:"** — the request parameters, all binding:
- "spice level N/10" — a CEILING, not a target (§3). Every quest must sit at or below it.
- "group size" — match pronouns and roles per §7; every member needs an active role.
- "time available M minutes" — every quest must fit the window, including getting there.
- "Constraint: walking distance only, no car." — no quest may require driving; keep everything reachable on foot.
- "Cost: free." — each quest must cost under $5 per person, ideally $0. No paid venues, no ticketed events, no quest that requires a meaningful purchase.
- "Cost: cheap." — free or low-cost preferred; nothing over ~$15 per person.
- "Cost: any." — cost is not a constraint; free and paid activities are both fine when they fit.

**"BANNED TITLES:"** (optional) — a blocklist of the user's recently seen quest titles, oldest first. Do NOT generate any quest whose title or core mechanic closely matches one (exact or near-paraphrase). Generating a banned quest is a failure — treat the list as a hard blocklist, not inspiration.

**Server post-processing (why sloppiness is wasted).** The server independently drops quests that trip a §8 safety ban or near-duplicate a banned title, scrubs any leaked venue names, and discards malformed JSON. A dropped quest costs the user a visible slot — construct clean, rule-following quests the first time.

**Batch self-check before emitting.** Run down this list for the finished batch: (1) every description is 10-14 words, never over 16 — count them; (2) every title is 5-8 words; (3) no title matches or paraphrases a banned title; (4) at most 1 food-flavored quest, and no food used as a mechanic, reward, or penalty anywhere; (5) the batch spans at least 3 different categories unless a single category was requested; (6) every quest sits at or below the spice ceiling; (7) every quest fits the time window, the group size, and any walking/cost constraints; (8) no proper-noun venues, streets, or landmarks anywhere; (9) valid minified JSON, correct key set, nothing else in the output. Fix any failure BEFORE emitting — the array you return is final.`;

export const SYSTEM_PROMPT = `${SKILL_BODY}${REQUEST_PROTOCOL}`;

// ---------- Helpers ----------

export function clamp(n: number, lo: number, hi: number): number {
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

export function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

export function normalize(
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

// Compact per-request rendering — usage semantics live in the cached
// REQUEST_PROTOCOL ("use at least one tag per quest, touch 3+ axes").
function renderDiversitySeed(seed: DiversitySeed): string {
  return `DIVERSITY SEED:
- verb: ${seed.verb}
- setting: ${seed.setting}
- prop/constraint: ${seed.prop}
- group dynamic: ${seed.group_dynamic}`;
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

export function isFoodQuest(quest: ClaudeQuest): boolean {
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

export function findSafetyViolation(
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

export function titleBigrams(title: string): Set<string> {
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

export function bigramJaccard(a: string, b: string): number {
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

export const SIMILARITY_THRESHOLD = 0.45;
const SAFETY_LOG = process.env.GENERATE_DEBUG === "1";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function shareThreeConsecutive(a: string, b: string): boolean {
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

/**
 * previousTitles is client-controlled text interpolated into the prompt —
 * cap the count (the ring buffer holds 30) and each title's length, and
 * strip newlines/control characters so a hostile client can't smuggle
 * multi-line instructions or megabyte strings into the message.
 */
export function sanitizePreviousTitles(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 80))
    .filter(Boolean)
    .slice(-30);
}

/**
 * Sequential near-duplicate filter. A quest is dropped when its title sits
 * at or over the bigram-Jaccard threshold (or shares 3 consecutive words)
 * with any banned previous title OR any quest already kept from this batch.
 * Order-preserving, so the stream path's progressive emission and its
 * authoritative reconcile pass accept the exact same prefix.
 */
export function filterNearDuplicates(
  quests: ClaudeQuest[],
  previousTitles: string[],
  alreadyKeptTitles: string[] = [],
): { kept: ClaudeQuest[]; dropped: string[] } {
  const kept: ClaudeQuest[] = [];
  const dropped: string[] = [];
  const keptTitles = [...alreadyKeptTitles];
  for (const q of quests) {
    const title = typeof q?.title === "string" ? q.title : "";
    if (isNearDuplicate(title, previousTitles, keptTitles)) {
      dropped.push(title);
    } else {
      kept.push(q);
      keptTitles.push(title);
    }
  }
  return { kept, dropped };
}

export function isNearDuplicate(
  title: string,
  previousTitles: string[],
  siblingTitles: string[],
): boolean {
  const overlaps = (other: string) =>
    bigramJaccard(title, other) >= SIMILARITY_THRESHOLD ||
    shareThreeConsecutive(title, other);
  return previousTitles.some(overlaps) || siblingTitles.some(overlaps);
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

export function scrub(
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

// Shared prompt builder — used by both the JSON POST handler and the streaming
// endpoint so the two paths can never drift. Returns the user message plus the
// histogram (computed once here because buildHistogram() shuffles, so the value
// logged for review must be the same one that went into the prompt).
export function buildUserMessage(p: {
  region: string;
  spiceLevel: number;
  groupSize: GroupSizeBand;
  timeAvailable: number;
  requestedCategory: string | null;
  canDrive: boolean;
  costPref: CostPref | null;
  vibes: string[];
  localTime: LocalTime | null;
  typeCounts: Record<string, number>;
  previousTitles: string[];
  /** Candidate count to request (default 3). The protocol's "Construct N
   * quests." line is emitted when this differs from 3. */
  count?: number;
}): { userMessage: string; histogram: string } {
  const count = p.count ?? 3;
  const countPrefix = count !== 3 ? `Construct ${count} quests.\n` : "";
  const groupSizeHint =
    p.groupSize === "solo"
      ? "1 person"
      : p.groupSize === "2"
        ? "2 people"
        : "3+ people";
  const previousStr = p.previousTitles.length
    ? `\n\nBANNED TITLES:\n${p.previousTitles.join("\n")}`
    : "";
  const categoryPrefix = p.requestedCategory
    ? `Generate quests in the ${p.requestedCategory} category.\n`
    : "";
  const driveStr = p.canDrive ? "" : " Constraint: walking distance only, no car.";
  const costStr = p.costPref ? ` Cost: ${p.costPref}.` : "";
  // Soft taste bias from onboarding — semantics ("roughly two-thirds, do not
  // exclude other categories") live in the cached protocol. Skipped when the
  // user picked an explicit category filter (a stronger, deliberate signal
  // that overrides ambient taste).
  const vibeStr =
    !p.requestedCategory && p.vibes.length > 0
      ? `\nVibe lean: ${p.vibes.map((v) => VIBE_MODEL_HINT[v]).join(", ")}`
      : "";
  const timeStr = p.localTime
    ? `\nLocal context: ${p.localTime.weekday}, ~${formatHour12(p.localTime.hour)}`
    : "";
  const histogram = buildHistogram(p.typeCounts);
  const diversityStr = renderDiversitySeed(pickDiversitySeed(p.previousTitles));

  // Volatile request lines ONLY. All instruction text — what each line means
  // and how to build/score/format the batch — lives in the cached
  // REQUEST_PROTOCOL section of the system prompt, so per-request tokens
  // stay minimal and the cached prefix stays byte-identical across calls.
  const userMessage = `${countPrefix}${categoryPrefix}Region: ${p.region}
Venue types nearby: ${histogram}

${diversityStr}
${vibeStr}${timeStr}
Inputs: spice level ${p.spiceLevel}/10, group size ${groupSizeHint}, time available ${p.timeAvailable} minutes.${driveStr}${costStr}${previousStr}`;

  // Dev-mode visibility into exactly what the model sees — the assembled
  // message is otherwise reconstructable only from scattered log fields.
  if (process.env.NODE_ENV === "development" || process.env.GENERATE_DEBUG === "1") {
    console.log("[generate] userMessage ↓\n" + userMessage);
  }

  return { userMessage, histogram };
}

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
  // Server-verified Pro flag — feeds model routing below. Never trust a
  // client-supplied tier for this.
  let isProUser = false;
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
    isProUser = isPro;
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

  const location = sanitizeRegion(body.location) || "your area";
  // Region is a coarse locale descriptor for geographic plausibility only.
  // Prefer the geocoded region; fall back to the raw location string so the
  // model always has *some* locale signal (the raw city is enough to avoid
  // "surf in landlocked Arizona" style misfires).
  const region = sanitizeRegion(body.region) || location;
  const places = Array.isArray(body.nearbyPlaces)
    ? body.nearbyPlaces
        .filter((p) => p && typeof p.name === "string" && typeof p.type === "string")
        .slice(0, 20)
    : [];
  // Histogram is built from the pre-capped typeCounts the place-fetch route
  // computed. If the client didn't send it, derive a fallback from places
  // (which are already capped by /api/nearby-places). Either way the keys
  // and values are sanitized before they can become prompt text.
  const typeCounts: Record<string, number> = sanitizeTypeCounts(
    body.typeCounts && typeof body.typeCounts === "object"
      ? body.typeCounts
      : (() => {
          const tc: Record<string, number> = {};
          for (const p of places) tc[p.type] = (tc[p.type] ?? 0) + 1;
          return tc;
        })(),
  );
  const spiceLevel = clamp(Math.round(Number(body.spiceLevel) || 5), 1, 10);
  const groupSize: GroupSizeBand =
    body.groupSize === "solo" || body.groupSize === "2" || body.groupSize === "group"
      ? body.groupSize
      : "group";
  const timeAvailable = clamp(Math.round(Number(body.timeAvailable) || 90), 5, 360);
  const excludeIds = Array.isArray(body.excludeIds)
    ? body.excludeIds.slice(0, 200)
    : [];
  const previousTitles = sanitizePreviousTitles(body.previousTitles);
  const categoryRaw =
    typeof body.category === "string" ? body.category.trim() : "";
  const requestedCategory =
    categoryRaw && categoryRaw.toLowerCase() !== "all" ? categoryRaw : null;
  const canDrive = body.canDrive !== false;
  const costPref = sanitizeCostPref(body.costPref, body.lowCostOnly === true);
  const vibes = sanitizeVibes(body.vibeCategories);
  const localTime = sanitizeLocalTime(body.localHour, body.localWeekday);

  // Overgenerate-and-rank: ask for 6 candidates, hard-filter, ship the best
  // 3. One model call either way; ~2x output tokens buys a ranked selection
  // plus headroom so safety/dup/constraint drops rarely leave a short batch.
  const BATCH_COUNT = 6;
  const TARGET_COUNT = 3;

  // Model routing: first roll of a session (empty blocklist) and Pro users
  // get the stronger model; rerolls stay on the fast one. Every call in
  // this request (main + any re-ask) uses the same routed model so the
  // per-model prompt cache stays warm within the request.
  const modelRoute = pickModel({
    isFirstRoll: previousTitles.length === 0,
    isPro: isProUser,
  });
  console.log("[generate] model", modelRoute);

  const { userMessage: baseUserMessage, histogram } = buildUserMessage({
    region,
    spiceLevel,
    groupSize,
    timeAvailable,
    requestedCategory,
    canDrive,
    costPref,
    vibes,
    localTime,
    typeCounts,
    previousTitles,
    count: BATCH_COUNT,
  });

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
  let lastText = "";
  let stopReason: string | null = null;

  // Per-stage timing — mirrors the [nearby-places] breakdown so before/after
  // p95 work can be measured rather than guessed. `llmUsage` captures the
  // per-call token accounting (incl. cache_read vs cache_creation) so we can
  // confirm prompt caching is actually being HIT.
  const llmStageMs: number[] = [];
  const llmUsage: Array<Record<string, number | string | undefined>> = [];

  function recordUsage(u: Anthropic.Messages.Usage | undefined): void {
    if (!u) return;
    const read = u.cache_read_input_tokens ?? 0;
    const create = u.cache_creation_input_tokens ?? 0;
    const create1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const create5m = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    // HIT = the cached prefix was read; MISS = we re-paid to (re)create it.
    const cacheHit = read > 0 && create === 0;
    llmUsage.push({
      model: modelRoute.model,
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
    // miss confirms the 1h extended TTL is actually being applied. The model
    // is included so per-model daily token/cost totals (and per-model cache
    // health — the cache is PER-MODEL) can be aggregated from logs.
    console.log("[generate] cache", {
      model: modelRoute.model,
      routeReason: modelRoute.reason,
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
    // Main call, plus ONE corrective re-ask when the output is malformed or
    // truncated. Malformed JSON was previously terminal (break → 503) while
    // the whole retry budget sat reserved for safety violations; safety is
    // now enforced by the hard-drop pipeline below instead of conversation
    // retries, so violators can never ship regardless of retry luck.
    for (let attempt = 0; attempt < 2; attempt++) {
      const llmStart = Date.now();
      const response = await client.messages.create(
        {
          model: modelRoute.model,
          // 6 candidates fit in ~450-550 output tokens with the slim 3-key
          // schema; 1000 bounds the tail without truncating valid minified
          // JSON (the old 384 ceiling could cut the array mid-object, which
          // read as a parse failure and 503'd the whole request).
          max_tokens: 1000,
          // Held at 0.75 — higher temperatures biased toward JSON schema
          // drift without measurably better variety.
          temperature: 0.75,
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
      stopReason = response.stop_reason ?? null;

      const textBlock = response.content.find((b) => b.type === "text");
      const text =
        textBlock && textBlock.type === "text" ? textBlock.text : "";
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = extractJsonArray(text);
        } catch {
          parsed = null;
        }
      }
      if (Array.isArray(parsed)) {
        lastParsed = (parsed as ClaudeQuest[]).slice(0, BATCH_COUNT);
        lastText = text;
        break;
      }

      console.log("[generate] parse failure", {
        attempt: attempt + 1,
        stopReason,
        textLen: text.length,
      });
      if (attempt === 0) {
        messages.push({ role: "assistant", content: text || "(empty)" });
        messages.push({
          role: "user",
          content:
            stopReason === "max_tokens"
              ? "Your output was cut off before the array closed. Return ONLY the complete minified JSON array — trim every description toward 10 words so it fits."
              : "That was not parseable JSON. Return ONLY the minified JSON array of quest objects — no prose, no markdown fences.",
        });
      }
    }

    clearTimeout(timer);

    if (!lastParsed) {
      return NextResponse.json(
        { ok: false, error: "no valid model output" },
        { status: 503 },
      );
    }

    // Observational report — venue leaks, food density, spice drift. Logged
    // for owner review; enforcement lives in the hard-drop pipeline + ranker
    // below, which act on every batch regardless of what this reports.
    const report = detectViolations(
      lastParsed,
      rawNames,
      spiceLevel,
      requestedCategory,
      previousTitles,
    );
    console.log("[generate] batch", {
      questCount: lastParsed.length,
      rawNames: rawNames.length,
      violations: report.violations.length,
      violationList: report.violations,
      leaked: report.leakedNames,
    });

    // Scrub leaked venue names UNCONDITIONALLY (stream-path parity). The old
    // violation-gated scrub let a Food-category quest ship a real venue name
    // in an otherwise clean batch, and ranking should see final text anyway.
    scrub(lastParsed, places);

    // ---------- Hard drops, then ONE shortfall re-ask ----------
    //
    // Safety violators are dropped BEFORE normalize — previously they could
    // ship after retry exhaustion, or survive via a stale lastParsed when a
    // corrective retry returned unparseable text. Near-dupes (≥0.45 bigram
    // Jaccard or 3 shared consecutive title words vs the blocklist or a
    // sibling) and detectable constraint violations (car-required when
    // walking-only, paid when free-only) drop with them. With 6 candidates,
    // drops rarely leave a short pool; when they do, spend ONE small extra
    // call — with its own timeout, since the main 25s window is spent.
    const walkingOnly = !canDrive;
    const freeOnly = costPref === "free";
    const rankerHooks = { findSafetyViolation, isNearDuplicate };
    const filtered = hardFilterQuests(lastParsed, {
      previousTitles,
      walkingOnly,
      freeOnly,
      hooks: rankerHooks,
    });
    let pool = filtered.kept;
    if (filtered.dropped.length > 0) {
      console.log("[generate] hard-dropped", filtered.dropped);
    }

    if (pool.length < TARGET_COUNT) {
      const need = TARGET_COUNT - pool.length;
      const reaskAbort = new AbortController();
      const reaskTimer = setTimeout(() => reaskAbort.abort(), 8_000);
      try {
        const reaskStart = Date.now();
        const reask = await client.messages.create(
          {
            model: modelRoute.model,
            max_tokens: 384,
            temperature: 0.75,
            system: [
              {
                type: "text",
                text: SYSTEM_PROMPT,
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            messages: [
              ...messages,
              { role: "assistant", content: lastText },
              {
                role: "user",
                content: `${filtered.dropped.length ? `These were rejected (${filtered.dropped.map((d) => `${d.title}: ${d.reason}`).join("; ")}). ` : ""}Generate exactly ${need} NEW quest${need === 1 ? "" : "s"}, clearly distinct from every banned title${pool.length ? ` and from: ${pool.map((q) => q.title).join("; ")}` : ""}, obeying every constraint from the request. Output ONLY a minified JSON array of exactly ${need} object(s), keys title/description/category.`,
              },
            ],
          },
          { signal: reaskAbort.signal },
        );
        llmStageMs.push(Date.now() - reaskStart);
        recordUsage(reask.usage);
        const rb = reask.content.find((b) => b.type === "text");
        const rtext = rb && rb.type === "text" ? rb.text : "";
        let rparsed: unknown = null;
        try {
          rparsed = extractJsonArray(rtext);
        } catch {
          rparsed = null;
        }
        if (Array.isArray(rparsed)) {
          const refillRaw = (rparsed as ClaudeQuest[]).slice(0, need);
          scrub(refillRaw, places);
          const refill = hardFilterQuests(refillRaw, {
            previousTitles,
            alreadyKeptTitles: pool.map((q) => q.title ?? ""),
            walkingOnly,
            freeOnly,
            hooks: rankerHooks,
          });
          pool = [...pool, ...refill.kept];
        }
      } catch (e) {
        console.log("[generate] shortfall re-ask failed", e);
      } finally {
        clearTimeout(reaskTimer);
      }
    }

    // ---------- Rank and select the shipped 3 ----------
    const selected = selectTopQuests(pool, {
      target: TARGET_COUNT,
      preferredCategories: preferredV4Categories(vibes),
      isFood: (q) => isFoodQuest(q as ClaudeQuest),
      allowFoodHeavy:
        (requestedCategory ?? "").toLowerCase() === "food",
    });
    console.log("[generate] ranked", {
      pool: pool.length,
      stopReason,
      selected: selected.map((q) => ({ title: q.title, category: q.category })),
    });
    lastParsed = selected;

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
