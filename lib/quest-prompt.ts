// Shared assembly for the side-quest generator prompt.
//
// This module is the single source of truth for the system prompt that the
// /api/generate route sends to the model. It exists so that:
//   1. The STABLE prompt content (skill body + website overrides + the full
//      few-shot gold set + negative examples) lives in ONE place and is baked
//      into the cached system block — see SYSTEM_PROMPT below. Anthropic
//      prompt caching keys on an exact prefix match, so anything that varies
//      per request (histogram, diversity seed, previous titles) MUST stay out
//      of the cached block and go in the user message instead. Previously the
//      few-shot + negative examples were rebuilt into the user message on every
//      request, so they were never cached and the cache prefix was just the
//      skill text. Moving them into SYSTEM_PROMPT both enlarges the cache hit
//      and stops the exemplars from churning per request.
//   2. The eval harness (eval/) can score the exact same exemplars the model
//      sees by reading lib/quest-examples.json.
import fs from "fs";
import path from "path";
import examplesData from "./quest-examples.json";

export type FewShotExample = {
  title: string;
  description: string;
  category: string;
  spice: number;
};

export type FewShotTierBlock = {
  tier: 1 | 2 | 3 | 4;
  spiceRange: [number, number];
  examples: FewShotExample[];
};

export type NegativeExample = {
  failureMode: string;
  bad: string;
  why: string;
  fix: string;
};

export const FEW_SHOT_GOLD: FewShotTierBlock[] =
  examplesData.fewShotGold as FewShotTierBlock[];
export const NEGATIVE_EXAMPLES: NegativeExample[] =
  examplesData.negativeExamples as NegativeExample[];

// ---------- Skill body ----------

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
  return "Side Quest Generator v4. Generate fun real-world group quests organized by spiciness tier.";
}

export const SKILL_BODY = loadSkillBody();

// ---------- Few-shot tier selection ----------
//
// The skill organizes quests into 4 spiciness tiers; map the user's 1-10
// slider onto the matching tier so the user message can point the model at the
// right exemplars without re-sending them (they're already in the cached
// system block).

export function fewShotTier(spice: number): 1 | 2 | 3 | 4 {
  if (spice <= 3) return 1;
  if (spice <= 6) return 2;
  if (spice <= 8) return 3;
  return 4;
}

// ---------- Stable example block (baked into the cached system prompt) ----------

function renderGoldBlock(): string {
  const lines: string[] = [];
  for (const block of FEW_SHOT_GOLD) {
    lines.push(
      `\nTier ${block.tier} (spice ${block.spiceRange[0]}-${block.spiceRange[1]}):`,
    );
    block.examples.forEach((ex, i) => {
      lines.push(`  ${i + 1}. ${ex.title} [${ex.category}] — ${ex.description}`);
    });
  }
  return lines.join("\n");
}

function renderNegativeBlock(): string {
  return NEGATIVE_EXAMPLES.map(
    (n) =>
      `- ❌ "${n.bad}"\n    failure mode: ${n.failureMode}\n    why it's bad: ${n.why}\n    do this instead: ${n.fix}`,
  ).join("\n");
}

const EXAMPLES_SECTION = `

---

# GOLD EXEMPLARS (match the SHAPE and ENERGY — never copy verbatim)

These are known-good side quests, grouped by spiciness tier. Notice they are intrinsically fun, commit to one concrete group action with a clear end condition, and use GENERIC anchors ("a 24-hour diner", "a big-box store", "a hardware-store employee") — never a real venue's proper name. Lean on the tier the user's spice level lands in; the user message tells you which.
${renderGoldBlock()}

# NEGATIVE EXAMPLES (do NOT emit anything shaped like these)

Each of these maps to a failure mode the rubric auto-rejects. Learn the shape so you avoid it:
${renderNegativeBlock()}`;

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

## ⚠️ HARD BANS — safety (READ AND SELF-CHECK BEFORE OUTPUTTING)

The app's default vibe is mild chaos. "Could get mildly side-eyed" or "could get asked to leave the store" is fine — that's the product. The bans below are the small set of things with real long-term-damage risk. Anything outside this list is allowed, even if it's a little chaotic. Do not over-sanitize.

1. **No library disruption quests.** No tag, racing, "whisper tournaments," shouting, scavenger sprints, or "stay until staff notices" inside libraries. Libraries stay quiet — real risk of cops being called. Library quests that involve quiet reading, browsing, or finding a book are fine.
2. **No cart racing with a rider, or in a crowded area.** Shopping-cart speed runs with a person inside the cart are out, and cart racing in a crowded store is out. An empty cart pushed around an empty parking lot at 1am or an empty aisle is fine — the line is "rider present" or "crowded area," not "cart-shaped object exists."
3. **Recording strangers without consent — INSTRUCTION, not a blanket ban.** If a quest involves filming or recording another person, the quest description must explicitly tell users to ask first and only film with consent. Filming yourselves and filming strangers who've agreed are always fine. Don't avoid cameras in quests — just include the consent instruction when strangers are involved.
4. **No risky-environment exploration.** No caves without gear, no spelunking, no mountain or free climbing, no cliff scrambling, no deep forest solo trips, no unmarked trails at night. Normal outdoor activity is fully fine — jogging an unfamiliar neighborhood, driving to a hill, walking through community parks, navigating in normal terrain before dark, any of that is allowed.

That's the whole list. Restaurant ordering shenanigans (fake names, identical orders, mystery orders), solo aisle sprints in a normal store, cashier-rotation payment bits, drive-thru games, parking-lot social bits, before-dark community navigation — all allowed. The threshold for a ban is significant long-term damage, not "an employee might be mildly annoyed."

## ⚠️ VARIETY GUARDRAILS (HARD)

The categories collapse to a single setting (supermarket / library / restaurant) when the histogram pulls you. The histogram is a SOFT HINT; do not make all 3 quests at the dominant venue type. Within any batch of 3:

- At most 1 quest per setting type (supermarket, restaurant, library, park, street, residential, transit, etc.). If two quests share a setting, replace one.
- At most 1 quest per "trick" (sprint, identical-order, backwards-walking, scavenger hunt, whisper game, etc.).
- Each quest commits to a different VERB (the activity action), and ideally a different group-dynamic (competitive / cooperative / secret / public).
`;

// The cached system prompt. Order matters for cache stability: only stable
// content lives here. Per-request content goes in the user message.
export const SYSTEM_PROMPT = `You are running as the backend for the Unemployment app's side quest generator. The canonical skill is loaded below from .claude/skills/side-quest-generator/SKILL.md. Follow it, then apply the website-specific overrides and study the exemplars at the bottom.

${SKILL_BODY}${WEBSITE_OVERRIDES}${EXAMPLES_SECTION}`;

// ---------- Per-request user-message pointer ----------
//
// The exemplars themselves are cached in SYSTEM_PROMPT; the user message only
// needs to tell the model which tier to lean on for this request.
export function renderTierPointer(spice: number): string {
  const tier = fewShotTier(spice);
  const block = FEW_SHOT_GOLD.find((b) => b.tier === tier);
  const range = block ? `${block.spiceRange[0]}-${block.spiceRange[1]}` : "";
  return `\n\nFor this request, lean on the Tier ${tier} (spice ${range}) gold exemplars in the system prompt — match their shape and energy, do NOT copy them, and do NOT name any real venue.`;
}

// ---------- Food detection (shared with the eval rubric) ----------

export const FOOD_KEYWORDS = [
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

export function isFoodQuest(quest: {
  title?: string;
  description?: string;
  category?: string;
}): boolean {
  if ((quest.category ?? "") === "Food") return true;
  const text = `${quest.title ?? ""} ${quest.description ?? ""}`.toLowerCase();
  return FOOD_KEYWORDS.some((kw) => text.includes(kw));
}
