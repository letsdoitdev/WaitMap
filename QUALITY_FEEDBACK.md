<!--
QUALITY_FEEDBACK.md — owner-curated side-quest quality feedback.

WHAT THIS DOES
The /api/generate (and /api/generate/stream) prompt reads this file once at
server start and folds it into the CACHED system prompt:
  • KEEP entries  -> GOOD few-shot exemplars the model should imitate.
  • KILL entries  -> tagged NEGATIVE examples the model must avoid.
Edit this file, redeploy (or restart the dev server), done. It does not change
the model, the safety pipeline, or the API contracts — it is additive prompt
content only. An EMPTY file = today's behavior (no change).

FORMAT
Two sections, "## KEEP" and "## KILL". Each entry is a "- Title:" block with
three single-line, labeled fields:

  - Title: <the quest title, 5-8 words>
    Description: <the quest description, 1-2 sentences, on ONE line>
    Reason: <one line — why this is a keeper / why this is bad>

NOTES
  • One entry per "- Title:" line. Title + Description are required; Reason is
    optional but strongly encouraged (it's shown to the model).
  • Keep each field on a SINGLE line.
  • Paste the FULL quest text (exactly what the app produced) so the exemplar is
    concrete.
  • HTML comments like this one are stripped before parsing, so the example
    below is inert until you copy it OUT of the comment into a section.

EXAMPLE (copy into "## KEEP" below, outside this comment, to activate):
  - Title: Highest Point Before Sunrise
    Description: Race in pairs with no GPS to the highest nearby spot before sunrise, then watch it together at the top.
    Reason: Cooperative outdoor exemplar — concrete anchor, near-certain payoff, story-generating.
-->

## KEEP

- Title: Interview One Stranger, Whole Crew
  Description: As a whole group, approach one willing stranger together and take turns asking about the worst decision they've ever made, building on each other's questions.
  Reason: Group-cohesion exemplar — the whole crew engages one person together instead of splitting into solo tasks; brief, willing interaction.

- Title: Chalk Portrait Relay on the Pavement
  Description: Grab sidewalk chalk and relay-draw portraits of each other on the pavement, each person adding to the previous drawing before passing the chalk on.
  Reason: Cooperative and equipment-light; every member has an active role, concrete and filmable.

- Title: Speed Ordering Synchronized Chaos
  Description: The whole group steps up to a counter and places the exact same order in perfect unison, word for word, then thanks the cashier together.
  Reason: Compelled-audience bit with the whole crew acting as one; legal and low-stakes.

- Title: Navigate a Neighborhood by Sound Alone
  Description: As a group, walk a few blocks choosing every turn by ear alone — follow traffic, music, or voices instead of looking where you're going. Keep a friend nearby.
  Reason: Novel constraint done together; exactly one short safety note, no heavy caveats.

- Title: Supermarket Fake Recall Stunt
  Description: As a group, calmly ask a supermarket employee where a product is because you "heard it got recalled" for a funny, obviously-harmless reason, then keep a straight face.
  Reason: Compelled-audience bit kept legal and plausible — no absurd false claims. Borderline case: leans on the app-wide safety disclaimer rather than per-quest caveats.

- Title: Furniture Store Couple Consultation
  Description: Pair off and roam a furniture store in character, asking employees which sofa best suits your imaginary shared home and staying in role the whole time.
  Reason: Sustained in-character bit with a compelled audience; pairs keep every member actively engaged.

- Title: Grocery Store Weird Order Relay
  Description: At a grocery store, build one deliberately odd but harmless basket as a relay — each person adds a single strange item and hands the basket to the next.
  Reason: Whole-group relay with a compelled audience; legal and low-stakes.

- Title: Guess a Stranger's Job in Five Questions
  Description: As a group, approach one willing stranger and try to guess their job or hobby using only five yes/no questions between you.
  Reason: Whole crew engages one person together; feasible, with a clear five-question end condition.

- Title: Balloon Relay Race Across an Open Field
  Description: Split into a relay and race a balloon across an open field, tapping it along without letting it touch the ground until the last person crosses.
  Reason: Active whole-group physical play, equipment-light; no filler taglines.

- Title: Constellation Hunt
  Description: Head somewhere dark together and find as many constellations as you can, comparing what each person spots until you run out of sky.
  Reason: Calm cooperative outdoor moment; plain instructions with no movie-narration phrasing.

- Title: Silent Sunrise Relay to High Ground
  Description: Before dawn, relay your way to the highest nearby spot in total silence, then watch the sunrise together once everyone arrives.
  Reason: Wholesome tier-1 whole-group exemplar; concrete payoff, story-generating.

- Title: Improv Story Chain on a Night Walk
  Description: Take a late-night stroll and build one shared story together, each person narrating one minute before passing it to the next.
  Reason: Plain real-life instructions with no jargon; cooperative and equipment-free.

- Title: Chalk a Giant Collaborative Mural
  Description: As a group, chalk one giant collaborative mural across a stretch of pavement, everyone drawing at the same time on the same picture.
  Reason: Whole-group creative cooperation; concrete and filmable.

## KILL

- Title: Balloon Debate at the Transit Stop
  Description: Try to convince strangers at a transit stop that a giant balloon is essential cargo that deserves its own seat.
  Reason: Unrealistic pretense — strangers won't buy it. If using absurd cargo, make it feasible-but-weird (e.g. carrying 100 pickles).

- Title: Parking Lot Obstacle Course Royale
  Description: Race an obstacle course weaving between other people's parked cars in a lot.
  Reason: Safety and logical confusion around strangers' cars; unclear whether on foot or in cars.

- Title: Decode a Stranger's Cryptic Note in 90 Seconds
  Description: Hand a stranger a cryptic riddle and have them solve it within ninety seconds.
  Reason: Infeasible — strangers won't stop to solve handed riddles.

- Title: Navigate a Neighborhood Blindfolded Relay
  Description: Blindfold one person and have the rest of the group guide them through a neighborhood by voice.
  Reason: Over-used blindfold-and-guide template; near-duplicate of backwards-navigation and sound-navigation. This skeleton is massively over-repeated.

- Title: Backwards Navigation Challenge Through a Neighborhood
  Description: Walk a neighborhood route entirely backwards while the group calls out directions.
  Reason: Near-duplicate of the blindfold relay; the guide-someone-through-a-neighborhood skeleton must stay rare.

- Title: Map a Loop by Landmarks Only
  Description: Plan and walk a two-mile loop using only visible landmarks, with no map or phone.
  Reason: Infeasible and vague — most people can't pick a clean two-mile loop or identify reliable landmarks.

- Title: Find the Oldest Tree in a Local Park
  Description: Search a park to find and identify its single oldest tree.
  Reason: Infeasible — no group can actually determine a tree's age; not fun.
