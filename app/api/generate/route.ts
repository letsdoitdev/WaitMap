import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { QuestCategory, QUESTS, QuestTemplate } from "@/lib/quests";
import { GeneratedQuest } from "@/lib/generate";
import { NearbyBucket, NearbyPlace } from "@/lib/nearby";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupSizeBand = "solo" | "2" | "group";

type GenerateBody = {
  location?: string;
  /** Full place objects (preferred). Server uses .name for the leak detector
   * and .type for the histogram + scrub-time category placeholder. */
  nearbyPlaces?: Array<Pick<NearbyPlace, "name" | "type"> & { bucket?: NearbyBucket }>;
  /** Per-bucket counts pre-computed by /api/nearby-places. */
  categoryCounts?: Partial<Record<NearbyBucket, number>>;
  spiceLevel?: number;
  groupSize?: GroupSizeBand;
  timeAvailable?: number;
  excludeIds?: string[];
  previousTitles?: string[];
  category?: string | null;
  canDrive?: boolean;
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

const WEBSITE_OVERRIDES = `

---

# WEBSITE-SPECIFIC OVERRIDES (apply on top of the skill above)

The skill above is the canonical source of truth for philosophy, rubric, anti-rubric, tiers, and safety. The rules below are website-specific constraints and HARD overrides that take precedence over the skill's prose output format and any conflicting guidance.

## ⚠️ FOOD BIAS WARNING — READ BEFORE GENERATING ANYTHING

The nearby venue list (when provided) is almost always dominated by restaurants, cafes, and food venues. You must actively resist this pull.

HARD RULE: In every batch of 3 quests, AT MOST 1 can involve a food venue or eating activity. The other 2 must be from completely different categories.

Before finalizing your 3 quests, count how many involve food/restaurants/cafes/eating. If the count is 2 or 3, discard the extras and replace them with non-food quests. This check is mandatory.

## ⚠️ VENUE NAMING BAN

The nearby places list is for geographic context ONLY. You are BANNED from naming any specific venue, restaurant, cafe, bar, park, playground, street, institution, or landmark from that list inside any quest title or description. No playground names, no street names, no institution names from the list.

Instead, use generic descriptors: "a nearby park", "a local playground", "a community space", "a public square".

HARD RULE: If your quest description contains any proper noun that appears verbatim in the nearbyPlaces list, rewrite it to remove the proper noun.

FOOD-IN-BODY BAN: Even when a quest is NOT categorized as Food, you must not embed food/eating/drinking/purchasing food as a mechanic, outcome, reward, or penalty within the quest description. No "loser buys coffee", no "grab a snack", no "buy a round." If you need a stakes mechanic, use non-food options: "loser picks the next quest," "winner chooses the route home," "take a group photo as proof."

SELF-CHECK BEFORE OUTPUTTING: Before writing each quest's title and description, ask yourself: "Does this contain any proper noun, street name, park name, building name, neighborhood name, or institution name from the nearbyPlaces list?" If yes, rewrite it. Also ask: "Does this contain any food/eating/drinking/purchasing as a penalty, reward, or mechanic?" If yes, rewrite it.

## SPICE CEILING — HARD RULE

Every quest you generate must have a spice score AT OR BELOW the user's requested spice level. If user sets spice 2, no quest may exceed 2/10. If user sets spice 5, no quest may exceed 5/10. This is a ceiling, not a target.

## GROUP SIZE HANDLING — HARD RULE

Match pronouns to the actual group size. groupSize 1 → "you", not "your group". groupSize 2+ → "your crew", "everyone", "the group" are fine.

Always output a real group RANGE in the JSON. Never minGroup === maxGroup. For groupSize=1 use min:1,max:3. For groupSize=2 use min:2,max:4. For groupSize=group use min:3,max:6 or wider.

## TIME RANGE — HARD RULE

Always output minTime < maxTime with at least a 15-minute spread. Never the same value for both. Example: 45-min quest → minTime:30, maxTime:60.

## CATEGORY-SPECIFIC RULES

- Nature quests: Must take place outdoors in open/natural spaces — parks, trails, streets, yards, fields, bodies of water. Do NOT route Nature quests to businesses, stores, or named venues.
- Outdoor quests: Can involve driving/transit to reach a destination, but the activity itself should happen outside, not inside a business.
- Social/Food quests: These are the appropriate categories for business/venue-based activities.
- Indoor quests: Done at home or inside, no travel required. Examples: rearrange furniture and eat dinner there, cook something none of you have cooked using only pantry items, video game where the controller passes every death.

## OUTPUT FORMAT (overrides the skill's prose format — return JSON)

Return a JSON array of exactly 3 quest objects. No markdown. No extra text. Each object:

\`\`\`
{
  "title": "5-8 word punchy title",
  "description": "2-3 sentences, concrete and specific, Gen Z tone, action-forward. NO 'don't do X' language. NO academic/writing tasks.",
  "category": one of ["Outdoor", "Food", "Social", "Challenge", "Culture", "Nightlife", "Creative", "Indoor"],
  "duration": "e.g. 1-2 hours",
  "groupSize": "e.g. 2-4 people",
  "spiceLevel": number 1-10,
  "rating": null
}
\`\`\`
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

function buildHistogram(
  places: Array<{ type: string }>,
): string {
  const counts: Record<string, number> = {};
  for (const p of places) {
    const label = TYPE_LABELS[p.type] ?? p.type;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, n]) => `${n} ${label}`);
  return parts.length ? parts.join(", ") : "(no nearby info)";
}

function spiceTier(s: number): 1 | 2 | 3 | 4 {
  if (s <= 3) return 1;
  if (s <= 6) return 2;
  if (s <= 8) return 3;
  return 4;
}

function representativeGroup(band: GroupSizeBand): number {
  if (band === "solo") return 1;
  if (band === "2") return 2;
  return 4;
}

function pickFewShot(
  band: GroupSizeBand,
  userSpice: number,
  requestedCategory: string | null,
  k: number,
): QuestTemplate[] {
  const userTier = spiceTier(userSpice);
  const rep = representativeGroup(band);
  const pool = QUESTS.filter((q) => {
    if (spiceTier(q.spice) !== userTier) return false;
    if (rep < q.minGroup || rep > q.maxGroup) return false;
    if (requestedCategory && requestedCategory !== q.category) return false;
    return true;
  });
  const source = pool.length >= k ? pool : QUESTS.filter((q) => spiceTier(q.spice) === userTier);
  const shuffled = source.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, k);
}

function renderFewShot(quests: QuestTemplate[]): string {
  if (quests.length === 0) return "";
  const lines = quests
    .map((q, i) => {
      const title = q.title.replaceAll("{city}", "your area").replaceAll("{venue}", "a nearby spot");
      const desc = q.description.replaceAll("{city}", "your area").replaceAll("{venue}", "a nearby spot");
      return `${i + 1}. ${title} — ${desc}`;
    })
    .join("\n");
  return `\n\nExamples of the quality and STYLE we want (do NOT copy verbatim, match the shape and energy):\n${lines}\n\nNotice these examples are intrinsically fun without naming specific real venues. They use generic anchors like "a 24-hour diner" not "Joe's Diner." Match this style.`;
}

// ---------- Validator ----------

const FOOD_VERBS =
  /\b(eat|eats|eating|ate|order|orders|ordered|taste|tastes|tasted|drink|drinks|drank|sandwich|coffee|sushi|wing|wings|popcorn|sample|samples|sampled|snack|snacks|meal|brunch|breakfast|lunch|dinner|dessert)\b/i;

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

  // Dupe titles
  for (let i = 0; i < quests.length; i++) {
    for (let j = i + 1; j < quests.length; j++) {
      if (shareThreeConsecutive(quests[i].title ?? "", quests[j].title ?? "")) {
        violations.push(
          `VIOLATION_DUPE: titles "${quests[i].title}" / "${quests[j].title}"`,
        );
      }
    }
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

  const groupSizeHint =
    groupSize === "solo"
      ? "1 person"
      : groupSize === "2"
        ? "2 people"
        : "3+ people";
  const previousStr = previousTitles.length
    ? `\n\nPreviously generated quest titles to AVOID repeating or closely resembling: ${previousTitles.join("; ")}. Generate quests that are meaningfully different in theme, venue type, and action.`
    : "";
  const categoryPrefix = requestedCategory
    ? `Generate quests in the ${requestedCategory} category. `
    : "";
  const driveStr = canDrive ? "" : " Constraint: walking distance only, no car.";
  const histogram = buildHistogram(places);
  const fewShot = pickFewShot(groupSize, spiceLevel, requestedCategory, 6);
  const fewShotStr = renderFewShot(fewShot);

  const baseUserMessage = `${categoryPrefix}Generate 3 side quests. Light context: the user is in ${location} (atmosphere only — NOT a venue list to draw from).

Venue TYPES available nearby (use as type-hints, NEVER name specific places): ${histogram}

For example, if they have parks, your quest can say "a nearby park" — do NOT name the park.${fewShotStr}

Inputs: spice level ${spiceLevel}/10, group size ${groupSizeHint}, time available ${timeAvailable} minutes.${driveStr}${previousStr}

Return a JSON array of exactly 3 quest objects following the OUTPUT FORMAT defined in the system prompt. No markdown, no explanation, just the raw JSON array.`;

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
      const response = await client.messages.create(
        {
          model: "claude-sonnet-4-5",
          max_tokens: 1500,
          temperature: 0.9,
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

      const arr = parsed as ClaudeQuest[];
      const report = detectViolations(arr, rawNames, spiceLevel, requestedCategory);
      lastParsed = arr;
      lastViolations = report.violations;

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

    return NextResponse.json({ ok: true, quests });
  } catch (err) {
    clearTimeout(timer);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 503 },
    );
  }
}
