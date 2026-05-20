import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { QuestCategory, QuestCost } from "@/lib/quests";
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
};

type ClaudeQuest = {
  id: string;
  title: string;
  description: string;
  category: string;
  spice: number;
  duration: number;
  groupSize: GroupSizeBand;
  cost: "free" | "$" | "$$";
};

const VALID_CATEGORIES: QuestCategory[] = [
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
];

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

1. The activity must be intrinsically fun on its own. Strip away the framing and stakes; if the core action isn't enjoyable, the quest fails.
2. Every group member has an active role. No solo-with-watchers.
3. Compelled audience over hoped audience. When strangers are part of the quest, they must be people obligated to engage (cashiers, employees, real game opponents) — not random passersby hoping to notice you.
4. Wholesome counts. Sunrise hikes, midnight diner runs, photo expeditions are as valid as chaos comedy.
5. No bland fake premises. If a quest uses a fake scenario, the premise must be intrinsically absurd ("car crashed into your kitchen"), not bland ("a leak you don't have").
6. Variety is the product. Within any batch, mix wholesome adventure, real challenges, social weirdness, and chaos comedy.

THE FOUR SPICINESS TIERS

Tier 1 — Very Chill (spice 1-3): Enjoy Life
Wholesome group experiences. Nature, calm adventure, beautiful moments, small novelty. No chaos required; no strangers required.
Vibe options: outdoor/nature reward, real cooperative challenge with beautiful endpoint, novel framing of normal activity, going somewhere nearby none of you have been, slow group bonding with small twist.

Tier 2 — Mid (spice 4-6): Light Adventure
Mild novelty, light social weirdness, real cooperative challenges with low stakes. Some stranger interaction possible but not central.
Vibe options: cooperative challenge with constraint (no GPS, time limit, specific find), group activity with real bet, light social weirdness at familiar venue, multi-stop tour with rating, IKEA-style fake roleplay that's light.

Tier 3 — Spicy (spice 7-8): Real Social Action
Group activities involving strangers, mild public weirdness, real bets, real adventure with stakes.
Vibe options: group order/purchase that's weird at register (whole group present), real talk with employees about absurd fake situations, props that drive direct stranger engagement, insert into existing public activity at wrong skill level.

Tier 4 — Very Spicy (spice 9-10): Group Chaos
Coordinated group stunts, public moments that risk getting kicked out, transgressive but legal real-world activities.
Vibe options: physical chaos at a venue, coordinated group stunt that escalates, real-world transactions with mild stakes, high-prop high-engagement public stunts.

UNIVERSAL RUBRIC — score each candidate 0-2 per axis. REJECT below 14/20:
1. Specificity — named venue, item, action, or count. Generic chains pass. "A coffee shop" fails.
2. Concrete action — user does a thing. No verbal rules. No writing tasks.
3. Anchor — something concrete makes this quest THIS quest (audience, count, specific item, constraint, venue, real natural reward).
4. Story-generating — there will be a thing to tell about it later.
5. Filmable in one phone shot — capturable. Relax at very chill tier.
6. Within budget.
7. Within time window and planning horizon.
8. Within mobility constraint.
9. Clear end condition — count, photo, return time, kick-out, achievement.
10. High payoff probability — expected reward/moment is near-certain, not contingent.

ANTI-RUBRIC — AUTO-REJECT if ANY apply:
- Verbal rule ("only speak in movie quotes")
- Writing, journaling, or reflection component
- Truly generic venue with no recognizable anchor
- "Make a memory" / wellness framing
- Could plausibly hurt someone or get them in real trouble
- Moral, learning, or self-improvement takeaway
- Theft, vandalism, trespassing on private property, harassment, drugs, real-money gambling, stalking
- Significant short-term effects beyond mild embarrassment or fatigue: injury, arrest, financial loss, ending a relationship, losing a job
- Age-gated activities without confirmed age (casino 21+, blood 17+, alcohol 21+)
- Manufactured comedic outcome — forced imagined moment that probably won't happen
- Annoying random people mid-task — intercepting shoppers/commuters for boring conversations
- Predictable boring response — interaction's likely reply is mundane
- No compelled audience for stranger-involved quests — passersby don't have to engage and almost never will
- Mundane combo items in repetition quests
- Passive group observation — one person acts, three watch
- Bland fake premise — fake scenario must be intrinsically absurd, not normal-sounding
- Non-engaging core activity — central action must be fun on its own merits
- Earnest tone — should sound like Gen Z wrote it, not a 35-year-old
- Over-engineering the description — stop at the action. No stage directions for the ride home.
- Rigid exact counts when open-ended would work better
- Unnecessary money/losing-stakes — only add when they actually make it more fun
- Just-ask-employees-questions quests — needs a PROP, FAKE SCENARIO, or in-character commitment
- Generating a worse variation of an existing seed
- Prescribing edgy or controversial specifics — let the group decide, provide the framework

GENERATION PROCESS:
1. Read the inputs (group size, time available, spice level, location/city).
2. Pick the spiciness tier from the spice input.
3. Within that tier, generate candidates VARYING the vibe. Do not collapse to one vibe.
4. Score each on universal rubric. Run anti-rubric. Reject below 14/20.
5. Return exactly 3 quests, all different vibes, all different action types.
6. Avoid repeating any of these previously shown quest titles: {previousTitles}

VARIETY RULES (enforced):
- All 3 quests must be from different vibe categories
- No two quests can have the same primary action type
- Include at least one chill/wholesome option and one that pushes comfort zone (relative to spice tier)

OUTPUT FORMAT — for each quest return valid JSON:
{
  "title": "5-8 word punchy title",
  "description": "2-3 sentences, concrete and specific, Gen Z tone, action-forward. NO 'don't do X' language. NO academic/writing tasks.",
  "category": one of ["Outdoor", "Food", "Social", "Challenge", "Culture", "Nightlife", "Creative"],
  "duration": "e.g. 1-2 hours",
  "groupSize": "e.g. 2-4 people",
  "spiceLevel": number 1-10,
  "rating": null
}

Return a JSON array of exactly 3 quest objects. No markdown. No extra text.`;

function isQuestCategory(s: string): s is QuestCategory {
  return (VALID_CATEGORIES as string[]).includes(s);
}

function bandToRange(band: GroupSizeBand): { min: number; max: number } {
  if (band === "solo") return { min: 1, max: 1 };
  if (band === "2") return { min: 2, max: 2 };
  return { min: 3, max: 10 };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalize(
  q: ClaudeQuest,
  excludeIds: Set<string>,
): GeneratedQuest | null {
  if (
    !q ||
    typeof q.id !== "string" ||
    typeof q.title !== "string" ||
    typeof q.description !== "string"
  ) {
    return null;
  }
  const category: QuestCategory = isQuestCategory(q.category) ? q.category : "Chaos";
  const spice = clamp(Math.round(Number(q.spice) || 5), 1, 10);
  const duration = clamp(Math.round(Number(q.duration) || 60), 5, 360);
  const band: GroupSizeBand =
    q.groupSize === "solo" || q.groupSize === "2" || q.groupSize === "group"
      ? q.groupSize
      : "group";
  const { min, max } = bandToRange(band);
  const cost: QuestCost =
    q.cost === "free" || q.cost === "$" || q.cost === "$$" ? q.cost : "free";

  // Ensure ID is unique within this batch and not already shown.
  let id = q.id.trim() || "ai-quest";
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
    minGroup: min,
    maxGroup: max,
    minTime: duration,
    maxTime: duration,
    cost,
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

  const nearbyStr = nearbyPlaces.length
    ? nearbyPlaces.join(", ")
    : "(none provided)";
  const excludeStr = excludeIds.length
    ? `\nQuest IDs already shown this session (avoid reusing these IDs): ${excludeIds.slice(-30).join(", ")}.`
    : "";
  const previousStr = previousTitles.length
    ? `\n\nPreviously generated quest titles to AVOID repeating or closely resembling: ${previousTitles.join(", ")}. Generate quests that are meaningfully different in theme, venue type, and action.`
    : "";

  const userMessage = `Generate 3 side quests for someone in ${location}. Nearby places include: ${nearbyStr}. Filters: spice level ${spiceLevel}/10, group size ${groupSize}, time available ${timeAvailable} minutes.${excludeStr}${previousStr}\n\nReturn ONLY a valid JSON array of 3 quest objects. No markdown, no explanation, just the raw JSON array. Each object must have keys: id (kebab-case unique), title, description, category (one of: Chaos, Outdoor, Social, Creative, Food, Late Night, Chill, Fitness, Nature, Tech, Exploration), spice (1-10), duration (minutes), groupSize ("solo"|"2"|"group"), cost ("free"|"$"|"$$").`;

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
    const quests: GeneratedQuest[] = [];
    for (const item of raw) {
      const normalized = normalize(item as ClaudeQuest, seen);
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
