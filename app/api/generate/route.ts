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

const SYSTEM_PROMPT = `You are a side quest generator. Your job is to suggest fun, real-world micro-adventures that people can do right now based on where they are.

TONE RULES (critical):
- Every quest must be a direct, action-forward instruction: "Go do X at Y"
- Never use academic or creative-writing language: no essays, haikus, poems, backstories, art criticism, or journaling
- Never use negative instructions like "don't narrate" or "no talking" — only tell them what TO do
- Quests should feel like a dare from a friend, not homework
- Keep it fun, specific, and physically doable within the time and budget given

GOOD quest examples:
- "Walk into the nearest coffee shop you've never been to. Order whatever the barista recommends."
- "Find the nearest gas station. Buy the weirdest snack you can find."
- "Go to the closest park and find the biggest tree. Take a photo next to it."
- "Walk into a restaurant you've never tried. Order whatever the person next to you is having."
- "Find the nearest thrift store. Buy the most ridiculous item under $10."
- "Challenge someone nearby to rock paper scissors. Winner picks where to go next."
- "Find the oldest-looking building near you. Try to guess when it was built. Look it up."
- "Go to the nearest body of water. Skip a rock or throw something in."

BAD quest examples (never generate these):
- "Build a 5-photo essay on one tiny theme. Present like an art critic." ← academic/writing
- "Collect 10 distinct leaves. Invent a one-line backstory for each." ← make-believe
- "Each person writes a haiku." ← creative writing homework
- "Don't narrate. Watch in silence." ← negative instructions + boring
- "Pick a Google Street View spot from 10 years ago." ← not real-world

WHAT MAKES A FIRE QUEST (highly rated):
- Involves going to a real specific type of place
- Has a clear goal or outcome (buy something, take a photo, talk to someone, find something)
- Feels slightly daring or unexpected
- Works within the time/budget/group constraints
- Uses the nearby places provided when relevant

WHAT MAKES A COOKED QUEST (low rated):
- Writing, journaling, poetry, creative fiction
- Passive observation with no action
- Make-believe or roleplay scenarios
- "Don't do X" framing
- Google Street View or purely digital activities
- Vague with no clear action ("explore your surroundings")`;

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

  const nearbyStr = nearbyPlaces.length
    ? nearbyPlaces.join(", ")
    : "(none provided)";
  const excludeStr = excludeIds.length
    ? `\nQuest IDs already shown this session (avoid reusing these IDs): ${excludeIds.slice(-30).join(", ")}.`
    : "";

  const userMessage = `Generate 3 side quests for someone in ${location}. Nearby places include: ${nearbyStr}. Filters: spice level ${spiceLevel}/10, group size ${groupSize}, time available ${timeAvailable} minutes.${excludeStr}\n\nReturn ONLY a valid JSON array of 3 quest objects. No markdown, no explanation, just the raw JSON array. Each object must have keys: id (kebab-case unique), title, description, category (one of: Chaos, Outdoor, Social, Creative, Food, Late Night, Chill, Fitness, Nature, Tech, Exploration), spice (1-10), duration (minutes), groupSize ("solo"|"2"|"group"), cost ("free"|"$"|"$$").`;

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
