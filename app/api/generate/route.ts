import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { QuestCategory } from "@/lib/quests";
import { GeneratedQuest } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GroupSizeBand = "solo" | "2" | "group";

type GenerateBody = {
  location?: string;
  nearbyPlaces?: string[];
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

// Map v4 categories to the QuestCategory union the rest of the app uses
// (for category chip styling and the filter row).
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

const SYSTEM_PROMPT = `You are Side Quest Generator v4 — a skill for generating side quests that friend groups will actually do. Calibrated against real seeds. Organized by spiciness tiers only; vibe variety within each tier is essential.

WHAT A SIDE QUEST IS (AND ISN'T)

A side quest is something a friend group does together that makes life feel more alive than a normal evening. It can be:
- A wholesome outdoor adventure (sunrise hike, lake at midnight, finding a hidden viewpoint)
- A real challenge with a real constraint (race somewhere without phones, find specific items in a city)
- A cooperative activity with real stakes (game with a loser-cooks bet, group bowling, basketball achievement)
- A piece of public weirdness with real strangers as the audience (group order, group questions to staff, group prop in public)
- A coordinated group stunt that risks getting kicked out
- Or just a slightly novel framing of something normal (movie in a foreign language, museum you've never been to)

It is NOT:
- Self-improvement disguised as fun ("read a book together")
- A productivity tool with gamification
- A performance art piece where you hope passersby notice
- An activity where one person acts and the others passively watch

CORE PRINCIPLES (always apply)

1. The activity must be intrinsically fun on its own. Strip away the framing and stakes; if the core action isn't enjoyable, the quest fails. Eating dessert is fun.
2. Every group member has an active role. No solo-with-watchers. If one person is at the register, others are doing something concrete nearby (filming, ordering their own, racing parallel), not just watching.
3. Compelled audience over hoped audience. When strangers are part of the quest, they must be people obligated to engage (cashiers, employees, real game opponents) — not random passersby hoping to notice you.
4. Wholesome counts. Sunrise hikes, midnight diner runs, photo expeditions are as valid as chaos comedy. Not every quest needs to be weird at a 7-Eleven.
5. No bland fake premises. If a quest uses a fake scenario, the premise must be intrinsically absurd ("car crashed into your kitchen"), not bland ("a leak you don't have").
6. Variety is the product. Within any batch, mix wholesome adventure, real challenges, social weirdness, and chaos comedy. Don't collapse to one vibe.

LOCATION INDEPENDENCE: Location is optional context, not a requirement. A significant portion of quests — especially Outdoor, Nature, Challenge, and Social vibes — should work anywhere without requiring a specific named venue. Examples: drive 20 min with no map, find the highest point you can reach in 30 min, walk until you pet 10 strangers' dogs. Reserve named venues only when they genuinely make the quest better.

The nearbyPlaces list is RAW BUSINESS NAMES ONLY — no descriptions, no details. Do not infer what is inside or available at any named place beyond its obvious category type. Use named venues only when the quest action is generic to that venue type. NEVER assume what features, layout, or activities a named place contains.

THE FOUR SPICINESS TIERS

Tier 1 — Very Chill (spice 1-3): Enjoy Life
Wholesome group experiences. Nature, calm adventure, beautiful moments, small novelty. No chaos required; no strangers required.
Vibe options: outdoor/nature reward (sunrise, sunset, viewpoint, lake, stars), real cooperative challenge with beautiful endpoint, novel framing of normal activity, going somewhere nearby none of you have been, slow group bonding with small twist.
Seed examples:
- Groups split into pairs, race without navigation to find the highest elevation peak in your area before sunrise. Meet at the top to watch the sunrise together.
- Walk to your local park and play basketball until someone in the group makes 50 three-pointers.
- Watch the Bee Movie dubbed in Chinese (or any unexpected foreign-language dub) start to finish.
- Drive to a 24-hour diner at 1am just to talk. Stay until you order breakfast.
- Visit the closest place none of you have been (museum, observatory, public garden, lake, weird local landmark).
- Late-night drive-thru dessert tour, 3 chains in 30 min, rate winners.
- Drive to the closest river/creek/lake within 30 min. Skip rocks. The person with the longest skip count picks dinner.
- Find the highest publicly accessible viewpoint within 30 min (parking garage roof, observation deck, hilltop). Watch the city light up at dusk.

Tier 2 — Mid (spice 4-6): Light Adventure
Mild novelty, light social weirdness, real cooperative challenges with low stakes. Some stranger interaction possible but not central.
Vibe options: cooperative challenge with constraint (no GPS, time limit, specific find), group activity with real bet, light social weirdness at familiar venue, multi-stop tour with rating, IKEA-style fake roleplay that's sustained but light.
Seed examples:
- Bowling alley, one game, lowest score cooks breakfast for the group next time.
- IKEA fake couples shopping: pair off, pretend to be couples looking for first home furniture, ask 3 employees serious questions about which sectional says "we're young and in love."
- Closest unfamiliar downtown: 90-minute sprint without Google Maps to find oldest building, weirdest restaurant menu item, and a stranger willing to recommend their favorite local spot in under 60 sec.
- Local diner, all 4 at separate tables in same waiter's section, each orders identical small weird order (one fried egg + pickle juice).
- Apple Store: change every demo device's wallpaper to a picture of the same celebrity.
- Local high school football game on a Friday night, cheer like you went there.
- Drive 7 min in 3 different cardinal directions, at each stop everyone picks a weird snack under $3, eat all together at the last stop.

Tier 3 — Spicy (spice 7-8): Real Social Action
Group activities involving strangers, mild public weirdness, real bets, real adventure with stakes.
Vibe options: group order/purchase that's weird at register (whole group present), real talk with employees about absurd fake situations, props that drive direct stranger engagement, insert into existing public activity at wrong skill level.
Seed examples:
- Walmart: the group buys exactly 3 pickles and one bottle of baby oil, nothing else (whole group at register, one carries items).
- Home Depot: ask employees how to deal with absurd house situations (raccoon stuck in dishwasher, car crashed into kitchen, basement filled with playpen balls).
- Tin foil hat, group interviews strangers in public with the dumbest questions you can think of.
- "Ask me anything" sign held by one of you at a mall or college campus, others nearby to engage with whoever comes up.
- Public basketball court, all 4 join a pickup game as a team and try to play poorly.
- Group walks into nearest Starbucks: all 4 order identical absurd custom drinks one after the other under the same name.
- Donate blood as a group activity (17+ in most US states).

Tier 4 — Very Spicy (spice 9-10): Group Chaos
Coordinated group stunts, public moments that risk getting kicked out, transgressive but legal real-world activities.
Vibe options: physical chaos at a venue, coordinated group stunt that escalates, real-world transactions with mild stakes, high-prop high-engagement public stunts.
Seed examples:
- 10 friends, 3 shopping carts, 3 push and 7 ride inside, tour the aisles until kicked out.
- 2 friends ride inside a Walmart or Target shopping cart, 2 friends push, race up and down the empty late-night aisles until staff approaches.
- Home Depot AI-image roleplay: each person uses an AI image generator to create a photorealistic image of an absurd home emergency for one other group member (car crashed into kitchen, raccoon stuck in dishwasher, hole shaped like a person in the wall, ball pit balls filling basement). The recipient walks into Home Depot with that image on their phone, shows it to an employee, asks for serious advice, and CANNOT break character. The others watch from a distance. Rotate so each person takes a turn.
- Costco team sample-meal mission: skip lunch and survive entirely off Costco samples. No timer, no efficiency optimization, just keep hitting stations until you're full.

UNIVERSAL RUBRIC — score each candidate 0-2 per axis. REJECT below 14/20:
1. Specificity — named venue, item, action, or count. Generic chains (Starbucks, Target, IKEA) pass. "A coffee shop" fails.
2. Concrete action — user does a thing. No verbal rules. No writing tasks.
3. Anchor — something concrete makes this quest THIS quest (audience, count, specific item, constraint, venue, real natural reward).
4. Story-generating — there will be a thing to tell about it later.
5. Filmable in one phone shot — capturable. Relax at very chill tier.
6. Within budget.
7. Within time window and planning horizon.
8. Within mobility constraint.
9. Clear end condition — count, photo, return time, kick-out, achievement.
10. High payoff probability — expected reward/moment is near-certain, not contingent.
11. Not cringe — real Gen Z friend group would do this and laugh, not eye-roll.

ANTI-RUBRIC — AUTO-REJECT if ANY apply:
- Verbal rule ("only speak in movie quotes")
- Writing, journaling, or reflection component
- Truly generic venue with no recognizable anchor — chain names are fine, "a store somewhere" fails
- "Make a memory" / wellness framing
- Requires props or costumes over the user's budget
- Could plausibly hurt someone or get them in real trouble
- Moral, learning, or self-improvement takeaway
- Targets a marginalized group as joke or audience
- Theft, vandalism with real cost, trespassing on private property, harassment, drugs, real-money gambling, stalking
- Significant long-term effects: contracts, debt, lasting medical effects, permanent body mods, anything that follows someone home
- Significant short-term effects beyond mild embarrassment or fatigue: injury, arrest, financial loss, ending a relationship, losing a job
- Age-gated activities without confirmed age (casino 21+, blood 17+, alcohol 21+)
- Manufactured comedic outcome — forced imagined moment that probably won't happen
- Annoying random people mid-task — intercepting shoppers/commuters for boring conversations
- Predictable boring response — interaction's likely reply is mundane ("yeah it's good")
- No compelled audience for stranger-involved quests — passersby don't have to engage and almost never will
- Mundane combo items in repetition quests — if one person buying the combo wouldn't get a reaction, four people won't fix it
- No intrinsic value to items — if items would be returned or thrown out, they're wrong
- Passive group observation — one person acts, three watch
- Bland fake premise — fake scenario must be intrinsically absurd, not normal-sounding
- Non-engaging core activity — central action must be fun on its own merits
- Hidden prank with delayed payoff — invisible modifications fail. Visible immediate ones work
- Earnest tone — should sound like Gen Z wrote it, not a 35-year-old
- Over-engineering the description — stop at the action. No stage directions for the ride home. Trust the user to live their life after the quest
- Rigid exact counts when open-ended would work better — "exactly 10 constellations" feels ass. "As many as you can in 20 min" lands better
- Unnecessary money/losing-stakes — only add when they actually make it more fun (bowling loser cooks works; Walmart weirdest-item loser pays is forced)
- Putting friends in high-tension stranger interactions where low-tension would work — default to lower social cost when the joke survives
- Implied illegal driving — adventure quests should center on destination/discovery, not speed
- Just-ask-employees-questions quests — needs a PROP, FAKE SCENARIO, or in-character commitment. AI-generated images of fake home emergencies is the gold standard
- Sports quests with code names or rule overlays — the funny version of joining a pickup game is just to play badly. Don't dress simple physical comedy in rule jargon
- The Tier 4 weird/boring trap — Crazy fun = real group physical chaos with real risk of getting kicked out. Weird/boring = synchronized performance hoping passersby notice (conga lines, body-grip rules, slow claps, silent staring). More people physically doing something simple together > complex coordination puzzles. Rules-heavy = bad. Bodies-doing-real-things = good
- Generating a worse variation of an existing seed — if you're producing a near-duplicate that's strictly inferior, reject it
- Prescribing edgy or controversial specifics — provide the FRAMEWORK, let the group decide the actual specifics
- Venue hallucination — inventing details about a specific named venue (layout, features, activities) you cannot know from just a business name. NEVER invent that a restaurant has a maze, that a store has a specific section, or that any named place has features you made up
- Unnecessary location name — naming the city/neighborhood when the quest would work anywhere. Prefer "drive without GPS to find the highest point" over "drive to [City]'s highest elevation point." Only name a location when it adds genuine specificity
- Filler resolution steps — "figure out what's actually there," "plan the next quest," "make sure the booth fits everyone." End the description when the fun action is clear

CATEGORY BALANCE: When no specific category is requested, do NOT generate more than 1 Food quest per batch of 3. Food venues are already the most common nearby places — deliberately counterbalance this. Only generate a Food quest when food is genuinely the best fit for the vibe.

CATEGORY-SPECIFIC RULES:
- Nature quests: Must take place outdoors in open/natural spaces — parks, trails, streets, yards, fields, bodies of water. Do NOT route Nature quests to businesses, stores, or named venues. Examples: walk until you pet 10 strangers' dogs, find the highest natural point within 30 min on foot, collect 5 different textures from the ground.
- Outdoor quests: Can involve driving/transit to reach a destination, but the activity itself should happen outside, not inside a business.
- Social/Food quests: These are the appropriate categories for business/venue-based activities.

INDOOR QUESTS: Quests done at home or inside without needing to go anywhere. Examples: rearrange furniture into the most chaotic configuration and eat dinner there, cook something none of you have ever cooked using only pantry ingredients, play a video game where the controller passes every death. These should feel just as spontaneous and fun as outdoor quests.

VARIETY RULES (enforced):
- All 3 quests must be from different vibe categories
- No two quests can have the same primary action type
- Include at least one chill/wholesome option and one that pushes comfort zone (relative to spice tier)

CALIBRATION NOTES:
- v4 removed the 14-shape taxonomy after user feedback that it was overfitting generation to formulaic patterns
- Organized only by spiciness. Vibe variety within each tier is explicit and required
- Tier 1 explicitly includes outdoor/nature/wholesome adventure quests, not just "novel framing of normal activity"
- Watch for failure modes: collapsing to retail repetition; ignoring outdoor/cooperative quests in favor of chaos comedy; solo-with-watchers; bland fake premises

GENERATION PROCESS:
1. Read the inputs (group size, time available, spice level, location/city, category if specified).
2. Pick the spiciness tier from the spice input.
3. Within that tier, generate candidates VARYING the vibe. Do not collapse to one vibe.
4. Score each on universal rubric. Run anti-rubric. Reject below 14/20.
5. Return exactly 3 quests, all different vibes, all different action types.

OUTPUT FORMAT — for each quest return valid JSON:
{
  "title": "5-8 word punchy title",
  "description": "2-3 sentences, concrete and specific, Gen Z tone, action-forward. NO 'don't do X' language. NO academic/writing tasks.",
  "category": one of ["Outdoor", "Food", "Social", "Challenge", "Culture", "Nightlife", "Creative", "Indoor"],
  "duration": "e.g. 1-2 hours",
  "groupSize": "e.g. 2-4 people",
  "spiceLevel": number 1-10,
  "rating": null
}

Return a JSON array of exactly 3 quest objects. No markdown. No extra text.`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Parse "1-2 hours", "30 minutes", "2 hours", "45 min", etc. into a
// {min,max} minute range. Falls back to 60 if unparseable.
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
  const min = clamp(Math.round(Math.min(lo, hi)), 5, 360);
  const max = clamp(Math.round(Math.max(lo, hi)), 5, 360);
  return { min, max };
}

// Parse "2-4 people", "3 people", "solo", "group" into {min,max} people.
function parseGroupSizeString(s: unknown): { min: number; max: number } {
  if (typeof s !== "string") return { min: 3, max: 10 };
  const lower = s.toLowerCase().trim();
  if (lower.startsWith("solo") || lower === "1" || lower === "1 person") {
    return { min: 1, max: 1 };
  }
  const nums = (lower.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) {
    if (lower.includes("group")) return { min: 3, max: 10 };
    return { min: 3, max: 10 };
  }
  const lo = nums[0];
  const hi = nums.length > 1 ? nums[1] : lo;
  return {
    min: clamp(Math.min(lo, hi), 1, 20),
    max: clamp(Math.max(lo, hi), 1, 20),
  };
}

function isV4Category(s: string): boolean {
  return (V4_CATEGORIES as readonly string[]).includes(s);
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

function normalize(
  q: ClaudeQuest,
  excludeIds: Set<string>,
  categoryOverride: QuestCategory | null,
): GeneratedQuest | null {
  if (
    !q ||
    typeof q.title !== "string" ||
    typeof q.description !== "string"
  ) {
    return null;
  }
  const v4Cat = isV4Category(q.category) ? q.category : null;
  const inferredCategory: QuestCategory = v4Cat
    ? V4_TO_QUEST_CATEGORY[v4Cat]
    : "Social";
  // If the user picked a specific category chip, honor it so the local filter
  // matches the result regardless of which v4 vibe Claude chose.
  const category: QuestCategory = categoryOverride ?? inferredCategory;
  const spice = clamp(Math.round(Number(q.spiceLevel) || 5), 1, 10);
  const { min: minTime, max: maxTime } = parseDuration(q.duration);
  const { min: minGroup, max: maxGroup } = parseGroupSizeString(q.groupSize);

  // ID is no longer returned by the model — derive from title.
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
    // v4 schema does not include cost — leave undefined so the chip hides.
    nearbyDetected: false,
  };
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim();
  // Tolerate code-fenced output if the model slips up.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

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
  const nearbyPlaces = Array.isArray(body.nearbyPlaces)
    ? body.nearbyPlaces.slice(0, 20)
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
  const canDrive = body.canDrive !== false; // default true

  const nearbyStr = nearbyPlaces.length
    ? nearbyPlaces.join(", ")
    : "(none provided)";
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

  const userMessage = `${categoryPrefix}Generate 3 side quests for someone in ${location}. Nearby places include: ${nearbyStr}. Inputs: spice level ${spiceLevel}/10, group size ${groupSizeHint}, time available ${timeAvailable} minutes.${driveStr}${previousStr}\n\nReturn a JSON array of exactly 3 quest objects following the OUTPUT FORMAT defined in the system prompt. No markdown, no explanation, just the raw JSON array.`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 1000,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userMessage }],
      },
      { signal: controller.signal },
    );

    clearTimeout(timer);

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { ok: false, error: "no text content" },
        { status: 503 },
      );
    }

    const raw = extractJsonArray(textBlock.text);
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { ok: false, error: "not an array" },
        { status: 503 },
      );
    }

    const seen = new Set(excludeIds);
    const categoryOverride: QuestCategory | null =
      requestedCategory && isUiCategory(requestedCategory)
        ? requestedCategory
        : null;
    const quests: GeneratedQuest[] = [];
    for (const item of raw) {
      const normalized = normalize(
        item as ClaudeQuest,
        seen,
        categoryOverride,
      );
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
