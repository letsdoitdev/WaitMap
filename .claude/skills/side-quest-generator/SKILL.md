---
name: side-quest-generator
description: Generate spontaneous side quests for friend groups (mostly ages 16 to 25) to do together. Use this skill whenever the user wants a side quest, asks "what should we do", says they are bored with friends, wants a random thing to do, asks for a group activity idea, or says something like "we need an idea for tonight" even if the exact phrase "side quest" never appears. Always trigger this skill for any request that smells like "give me something fun to do with friends right now or this weekend." Quests range from wholesome group adventures (sunrise hikes) to public chaos comedy (group stunts at retail), with everything in between. The skill is organized by spiciness level only; vibe variety within each tier is the whole point.
---

# Side Quest Generator (v4)

Generate side quests friend groups will actually do. Organized by spiciness tier; vibe variety within each tier is essential.

## What a side quest IS

Something a friend group does together that makes life feel more alive than a normal evening: a wholesome adventure, a real challenge with a real constraint, a cooperative activity with stakes, public weirdness with strangers as a compelled audience, or a coordinated stunt that risks getting kicked out.

## What it ISN'T

- Self-improvement disguised as fun
- A performance art piece hoping passersby notice
- Solo-with-watchers (one person acts, others watch)
- Generic tourist activity ("visit a museum," "try a new restaurant")

## Core principles

1. **Intrinsically fun.** Strip away the framing — the core action must be enjoyable.
2. **Active group role for every member.** No solo-with-watchers.
3. **Compelled audience.** When strangers are involved they must be obligated to engage (cashiers, employees, real opponents) — never hoped-for passersby.
4. **Wholesome counts.** Sunrise hikes and midnight diner runs are as valid as chaos comedy.
5. **Premises must be absurd, not bland.** "Car crashed into your kitchen" — yes. "A leak you don't have" — no.
6. **Variety per batch.** Mix wholesome adventure, real challenges, social weirdness, and chaos. Don't collapse to one vibe.

## Four spiciness tiers

### Tier 1 — Very Chill (1–3): Enjoy Life
Wholesome shared experiences. Nature, calm adventure, beautiful moments.
Vibes: outdoor reward (sunrise, viewpoint, lake), cooperative challenge with a beautiful endpoint, novel framing of a normal activity, going somewhere none of you have been.

### Tier 2 — Mid (4–6): Light Adventure
Mild novelty, light social weirdness, cooperative challenges with low stakes.
Vibes: constraint challenge (no GPS, time limit, specific find), group activity with a real bet, multi-stop tour with rating, sustained-but-light fake roleplay.

### Tier 3 — Spicy (7–8): Real Social Action
Group activities involving strangers, mild public weirdness, real bets, real adventure with stakes.
Vibes: weird group order at the register, real talk with employees about absurd fake situations, prop that drives direct stranger engagement, insert into a real public activity at the wrong skill level.

### Tier 4 — Very Spicy (9–10): Group Chaos
Coordinated group stunts, public moments that risk getting kicked out, transgressive but legal.
Vibes: physical chaos at a venue, escalating coordinated stunt, real-world transactions with mild stakes, high-prop high-engagement public stunts.

## Universal rubric — auto-reject below 14/20 (score 0–2 per axis)

1. Specificity — named venue, item, action, or count.
2. Concrete action — user does a thing.
3. Anchor — something concrete makes this quest THIS quest.
4. Story-generating — there will be a thing to tell later.
5. Filmable in one phone shot (relax at tier 1).
6. Within budget.
7. Within time + planning horizon.
8. Within mobility constraint.
9. Clear end condition — count, photo, return time, kick-out, achievement.
10. High payoff probability — the reward is near-certain, not contingent.

## Anti-rubric (auto-reject if ANY apply)

- Verbal rule ("only speak in movie quotes")
- Writing/journaling/reflection component
- Wellness or "make a memory" framing
- Generic venue ("a store somewhere") — chain names are fine
- Targets a marginalized group as joke or audience
- Theft, vandalism, trespass on private property, harassment, drugs, real-money gambling
- Significant short- or long-term effects beyond mild embarrassment
- Age-gated activities without explicit age confirmation
- No compelled audience for stranger-involved quests
- Solo-with-watchers
- Manufactured comedic outcome (forced moment that probably won't happen)
- Predictable boring response ("yeah it's good")
- Bland fake premise — must be intrinsically absurd
- Hidden prank with delayed payoff — invisible mods fail; visible immediate ones work
- Earnest 35-year-old tone — should sound Gen Z
- Stage directions for the ride home — stop at the action
- Rigid exact counts when open-ended would land better
- Unnecessary losing-stakes when the activity is already enough
- Just-ask-employees-questions with no prop/scenario/character
- Sports quests with code names or rule overlays — just play badly
- Tier 4 "weird/boring trap": synchronized performance hoping passersby notice (conga lines, slow claps, silent staring). Crazy fun = real group physical chaos with real kick-out risk.
- Worse variation of an existing seed
- Prescribing edgy specifics — provide the framework, let the group pick the take

## Anti-food bias (HARD)

The nearby venue list is dominated by restaurants/cafes/bars. Resist it.

**HARD RULE: At most 1 food quest per batch of 3.** Other 2 must be different categories.

Before finalizing, count food/restaurant/cafe/eating quests. If ≥ 2, drop the excess and replace with non-food quests.

**Food-in-body ban:** Even non-Food quests must not embed eating/drinking/buying-food as mechanic, reward, or penalty. No "loser buys coffee," no "grab a snack." Replace with "loser picks the next quest," "winner picks the route home," "group photo as proof."

## Generation process

1. Read inputs (group, time, spice, location, category if specified).
2. Pick the spiciness tier from spice.
3. Within that tier, generate candidates VARYING the vibe — don't collapse.
4. Score each: universal rubric, then anti-rubric. Reject below 14/20.
5. Return exactly 3, all different vibes, all different action types.

## Output format (JSON)

Return a JSON array of exactly 3 quest objects. No markdown, no explanation.

```
{
  "title": "5–8 word punchy title",
  "description": "2–3 sentences, concrete and specific, Gen Z tone, action-forward. NO 'don't do X' language. NO writing tasks.",
  "category": one of ["Outdoor","Food","Social","Challenge","Culture","Nightlife","Creative","Indoor"],
  "duration": "e.g. 1–2 hours",
  "groupSize": "e.g. 2–4 people",
  "spiceLevel": number 1–10,
  "rating": null
}
```
