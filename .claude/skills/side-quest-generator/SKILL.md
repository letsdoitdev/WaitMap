---
name: side-quest-generator
description: Generate spontaneous side quests for friend groups (mostly ages 16 to 25) to do together. Use this skill whenever the user wants a side quest, asks "what should we do", says they are bored with friends, wants a random thing to do, asks for a group activity idea, or says something like "we need an idea for tonight" even if the exact phrase "side quest" never appears. Always trigger this skill for any request that smells like "give me something fun to do with friends right now or this weekend." Quests range from wholesome group adventures (sunrise hikes) to public chaos comedy (group stunts at retail), with everything in between. The skill is organized by spiciness level only; vibe variety within each tier is the whole point.
---

# Side Quest Generator (v4)

A skill for generating side quests that friend groups will actually do. Calibrated against real seeds. Lean structure: spiciness tiers as the only categorization. Vibe variety within each tier is essential.

## What a side quest is (and isn't)

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

## Core principles (these always apply)

1. The activity must be intrinsically fun on its own. Strip away the framing and stakes; if the core action isn't enjoyable, the quest fails. Eating dessert is fun.
2. Every group member has an active role. No solo-with-watchers. If one person is at the register, others are doing something concrete nearby (filming, ordering their own, racing parallel, etc.), not just watching.
3. Compelled audience over hoped audience (when there is an audience). When strangers are part of the quest, they should be people obligated to engage (cashiers, employees, real game opponents, real outdoor reality). Random passersby in a park or mall hoping to notice you = doesn't work. Passive public performance fails except in situations where people are interested — a stranger comes up to your friend holding a sign.
4. Wholesome counts. Quests that make people want to enjoy life are as valid as chaos comedy. Sunrise hikes, midnight diner runs, photo expeditions count. Not every quest needs to be weird at a 7-Eleven.
5. No bland fake premises. If a quest uses a fake scenario (asking about a problem you don't have), the premise itself must be intrinsically absurd ("car crashed into your kitchen", "raccoon stuck in dishwasher"), not bland ("a leak you don't have").
6. Variety is the product. Within any batch, mix wholesome adventure, real challenges, social weirdness, and chaos comedy. Don't collapse to one vibe.

## When to trigger

Trigger this skill (do not generate from general knowledge) when the user says:

- "give me a side quest"
- "what should we do"
- "we're bored"
- "random thing to do with friends"
- "we need an idea for tonight"
- any group-activity request

Also trigger when an external app sends a structured request with personalization parameters.

## Inputs to gather

If not provided, ask in one bundled message. Defaults if user is casual: group of 3 to 4, mild spicy (5), tonight, walk or one car, under 2 hours.

- spiciness (1 to 10)
- group_size
- budget (free | under $20 | under $50 | any)
- mobility (walk only | one car | multiple cars | public transit)
- planning_horizon (tonight | this weekend | next week or two | open-ended)
- time_window (30 min | 1 to 2 hours | half day | full day | multi-session)
- time_of_day (morning | afternoon | evening | late night)
- location_density (urban | suburban | rural)
- output_goal (a story to tell | TikTok content | just kill boredom | something to be proud of)

## The Four Spiciness Tiers

Spiciness sets the energy. Within each tier, vibe should vary across batches.

### Tier 1 — Very Chill (spice 1 to 3): Enjoy Life

Wholesome group experiences. Nature, calm adventure, beautiful moments, small novelty. The point is shared experience and feeling alive together. No chaos required; no strangers required.

Vibe options within this tier:

- Outdoor / nature reward (sunrise, sunset, viewpoint, lake, stars)
- Real cooperative challenge with a beautiful endpoint
- Novel framing of a normal activity
- Going somewhere nearby none of you have been
- Slow group bonding activity with a small twist

Seed examples:

- Groups split into pairs, race without navigation to find the highest elevation peak in your area before sunrise. Meet at the top to watch the sunrise together.
- Walk to your local park and play basketball until someone in the group makes 50 three-pointers.
- Watch the Bee Movie dubbed in Chinese (or any unexpected foreign-language dub) start to finish.
- Drive to a 24-hour diner at 1am just to talk. Stay until you order breakfast.
- Visit the closest place none of you have been (museum, observatory, public garden, lake, weird local landmark).
- Late-night drive-thru dessert tour, 3 chains in 30 min, rate winners.
- Drive to the closest river/creek/lake within 30 min. Skip rocks. The person with the longest skip count picks dinner.
- Find the highest publicly accessible viewpoint within 30 min (parking garage roof, observation deck, hilltop). Watch the city light up at dusk.

### Tier 2 — Mid (spice 4 to 6): Light Adventure

Mild novelty, light social weirdness, real cooperative challenges with low stakes, novel framings, real fun activities. Some interaction with strangers possible but not central.

Vibe options within this tier:

- Cooperative challenge with a constraint (no GPS, time limit, specific find)
- Group activity with a real bet (loser does X)
- Light social weirdness at a familiar venue
- Multi-stop tour with rating
- IKEA-style fake role-play that's sustained but light

Seed examples:

- Bowling alley, one game, lowest score cooks breakfast for the group next time.
- IKEA fake couples shopping: pair off, pretend to be couples looking for first home furniture, ask 3 employees serious questions about which sectional says "we're young and in love."
- DC Lincoln Memorial race: group starts at random location in DC, races to photograph the Lincoln Memorial without phones. (Adapt: random spot to local landmark, no phones.)
- Closest unfamiliar downtown: 90-minute sprint without Google Maps to find oldest building, weirdest restaurant menu item, and a stranger willing to recommend their favorite local spot in under 60 sec.
- Local diner, all 4 at separate tables in same waiter's section, each orders identical small weird order (one fried egg + pickle juice).
- Chipotle: burrito with only black beans, nothing else.
- Apple Store: change every demo device's wallpaper to a picture of LeBron James.
- Local high school football game on a Friday night, cheer like you went there.
- Drive 7 min in 3 different cardinal directions, at each stop everyone picks a weird snack under $3, eat all together at the last stop.

### Tier 3 — Spicy (spice 7 to 8): Real Social Action

Group activities involving strangers, mild public weirdness, real bets, real adventure with stakes. Real public action with real reactions.

Vibe options within this tier:

- Group order/purchase that's weird at the register (group all present, not solo+watchers)
- Real talk with employees about absurd fake situations
- Props that drive direct stranger engagement
- Insert into existing public activity at the wrong skill level
- Online challenge with real content goal

Seed examples:

- Walmart: the group buys exactly 3 pickles and one bottle of baby oil, nothing else (whole group at the register, one carries items).
- Home Depot: ask employees how to deal with absurd house situations (raccoon stuck in dishwasher, car crashed into kitchen, basement filled with playpen balls).
- Tin foil hat, group interviews strangers in public with the dumbest questions you can think of.
- "Ask me anything" sign held by one of you at a mall or college campus, others nearby to engage with whoever comes up.
- Public basketball court, all 4 join a pickup game as a team and try to play poorly.
- Random video chat with a content goal: each person needs to get 5 strangers to do a specific bit (admit they have skill issue, say "touch grass", recommend their favorite obscure song).
- Group walks into nearest Starbucks: all 4 order identical absurd custom drinks one after the other under the same name.
- Donate blood as a group activity (17+ in most US states).

### Tier 4 — Very Spicy (spice 9 to 10): Group Chaos

Coordinated group stunts, public moments that risk getting kicked out, transgressive but legal real-world activities. The group is visibly weird in public.

Vibe options within this tier:

- Physical chaos at a venue (shopping cart raids, conga lines)
- Coordinated group stunt that escalates
- Real-world transactions with mild stakes
- High-prop, high-engagement public stunts

Seed examples:

- 10 friends, 3 shopping carts, 3 push and 7 ride inside, tour the aisles until kicked out.
- 2 friends ride inside a Walmart or Target shopping cart, 2 friends push, race up and down the empty late-night aisles until staff approaches.
- Tin foil hat dumb-question interviewer but with a clipboard and 4 fake survey topics (group picks the actual topics so they hit their own spice level).
- Home Depot AI-image roleplay: each person uses an AI image generator to create a photorealistic image of an absurd home emergency for one other group member (e.g. car crashed into kitchen, raccoon stuck in dishwasher, hole shaped like a person in the wall, ball pit balls filling basement). The recipient has to walk into Home Depot with that image on their phone, show it to an employee, ask for serious advice on how to fix it, and CANNOT break character. The others watch from a distance. Rotate so each person takes a turn.
- Costco team sample-meal mission: 4 friends, the goal is just to skip lunch and survive entirely off Costco samples. No timer, no efficiency optimization, just keep hitting stations until you're full.
- IKEA 4-person backpack-grip conga: each person grips the back of the hoodie/backpack ahead. Walk the entire showroom path without breaking the chain.

## Universal rubric

Score each candidate 0 to 2 per axis. Reject below 14/20.

1. Specificity — named venue, item, action, or count. Generic chains (Starbucks, Target, IKEA) pass. "A coffee shop" fails.
2. Concrete action — user does a thing. No verbal rules. No writing tasks.
3. Anchor — something concrete makes this quest THIS quest (audience, count, specific item, constraint, specific venue, real natural reward).
4. Story-generating — there will be a thing to tell about it later.
5. Filmable in one phone shot — capturable. Relax this at very chill tier.
6. Within budget.
7. Within time window and planning horizon.
8. Within mobility constraint.
9. Clear end condition — count, photo, return time, kick-out, achievement.
10. High payoff probability — expected reward/moment is near-certain, not contingent.
11. Not cringe — real Gen Z friend group would do this and laugh, not eye-roll.

## Anti-rubric (auto-reject if ANY apply)

- Verbal rule ("only speak in movie quotes")
- Writing, journaling, or reflection component
- Truly generic venue with no recognizable anchor ("a store somewhere") — chain names are fine
- "Make a memory" / wellness framing
- Requires props or costumes over the user's budget
- Requires planning beyond the user's planning_horizon
- Could plausibly hurt someone or get them in real trouble
- Moral, learning, or self-improvement takeaway
- Targets a marginalized group as joke or audience
- Theft, vandalism with real cost, trespassing on private property, harassment, drugs, real-money gambling, stalking
- Significant long-term effects: procreation, contracts, debt, lasting medical effects, permanent body mods, anything that follows someone home
- Significant short-term effects beyond mild embarrassment or fatigue: injury, arrest, financial loss, ending a relationship, losing a job
- Age-gated activities without confirmed age (casino 21+, blood 17+, alcohol 21+)
- Manufactured comedic outcome — forced imagined moment that probably won't happen
- Annoying random people mid-task — intercepting shoppers/commuters for boring conversations
- Predictable boring response — interaction's likely reply is mundane ("yeah it's good")
- No compelled audience for stranger-involved quests — passersby don't have to engage and almost never will. The audience must be obligated (employees, real opponents).
- Mundane combo items in repetition quests — if one person buying the combo wouldn't get a reaction, four people won't fix it.
- No intrinsic value to items — if items would be returned or thrown out, they're wrong.
- Passive group observation — one person acts, three watch. Every group member needs an active role.
- Bland fake premise — if a fake scenario is used, it must be intrinsically absurd, not normal-sounding.
- Non-engaging core activity — central action must be fun on its own merits, not just a vehicle for stakes.
- Hidden prank with delayed payoff — invisible modifications fail. Visible immediate ones work.
- Earnest tone over meme-current tone — earnest sounds like a 35-year-old wrote it.
- Over-engineering the description — adding "and then drive home blasting a song you all agree on" type fluff at the end. Stop at the action. No stage directions for the ride home. Trust the user to live their life after the quest.
- Rigid exact counts when open-ended would work — "exactly 10 constellations," "exactly 3 throws each," "8 sample stations" make quests feel ass. "Until you've found enough," "until everyone's stopped enjoying it," "as many as you can in 20 min" land better.
- Unnecessary money or losing-stakes — not every quest needs "loser buys the items" or "lowest score pays for breakfast." Sometimes the activity is enough. Only add stakes when they actually make it more fun (bowling loser cooks works; Walmart weirdest-item loser pays for everything is forced).
- Putting friends in high-tension stranger interactions where low-tension would work — "ask the regular near you what they're eating" is asking strangers to engage when they didn't sign up. Lower-tension version: "all 4 order whatever the waiter randomly recommends." Default to lower social cost when the joke survives.
- Implied illegal driving — "race across a state line before sunset," "drive in a straight line for 20 min without stops" can imply speeding, distracted driving, or racing. Adventure quests should center on the destination/discovery, not on speed.
- Just-ask-employees-questions quests — asking absurd questions of employees alone is not funny. The shape needs a PROP, a FAKE SCENARIO, or an in-character commitment. AI-generated images of fake home emergencies (handed to Home Depot employees) is the gold standard: real employee, real visual evidence, real character commitment, group watches from a distance.
- Sports quests with code names or rule overlays — "call plays the divorced parent and Saturday brunch" is cringe. The funny version of joining a pickup game is just to play badly. Don't dress simple physical comedy in rule jargon.
- The "crazy fun" vs "weird/boring" line at Tier 4 — Crazy fun = real group physical chaos with real risk of getting kicked out (10 friends 3 carts riding, 2 friends in one cart driving around, group sample raid). Weird/boring = synchronized performance hoping passersby notice (conga lines, body-grip rules, cereal-aisle basketball, slow claps, silent staring). When in doubt at Tier 4: more people physically doing something simple together > complex coordination puzzles. Rules-heavy = bad. Bodies-doing-real-things = good.
- Generating a worse variation of an existing seed — if you're producing a near-duplicate of a seed that's strictly inferior (less crazy, more rules, weaker reward), reject it. The seed is the canonical version.
- Prescribing edgy or controversial specifics — for survey topics, prank questions, or any element that's intentionally provocative, let the group decide the specifics rather than scripting them. The skill provides the FRAMEWORK (e.g. "each person picks their most controversial take and gets 5 strangers to respond"), not the actual take. This also keeps the skill out of writing marginalized-group-targeting jokes.

## Safety floor

- Nothing illegal in the user's jurisdiction (US default)
- Nothing with significant long-term effects
- Nothing with significant short-term effects
- Nothing targeting a marginalized group as joke or audience
- Nothing sexual or with sexual undertones
- No coercion of strangers (no fake medical emergencies, fake 911, pranks on real services)
- Nothing that costs a business real operating disruption (brief weird interaction OK, tying up staff for an hour is not)
- Age-gated activities require explicit confirmation

## Generation process

1. Read inputs. If missing, ask in one bundled message. Use defaults if casual.
2. Pick spiciness tier from input.
3. Within that tier, generate candidates VARYING the vibe (outdoor/wholesome + cooperative + social weirdness + chaos as appropriate to spice level). Do not collapse to one vibe.
4. Score each on universal rubric. Run anti-rubric. Reject below 14/20.
5. Return the top N requested by user (default 3).
6. For bulk batches (10+ quests across spice levels), explicitly require vibe variety within each tier.

## Output format

For each quest:

- Title (5 to 8 words, punchy)
- Spice (X/10)
- What you do (2 to 3 sentences, concrete and specific)
- Time, Cost
- What good output looks like (1 sentence of likely reward/moment)

For bulk batches, compact format: title, spice, 1-2 sentence action, time, cost.

## Calibration notes

- v4 removed the 14-shape taxonomy after user feedback that it was overfitting generation to formulaic patterns.
- Now organized only by spiciness. Vibe variety within each tier is explicit and required.
- Tier 1 (Very Chill) now explicitly includes outdoor/nature/wholesome adventure quests, not just "novel framing of normal activity."
- Watch for failure modes: collapsing to retail repetition; ignoring outdoor/cooperative quests in favor of chaos comedy; solo-with-watchers; bland fake premises.
