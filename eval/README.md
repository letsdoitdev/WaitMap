# Side-quest eval harness

A lightweight, runnable eval for the side-quest generator. The "product" being
evaluated is the assembled prompt: `.claude/skills/side-quest-generator/SKILL.md`
+ the few-shot gold + negative examples in `lib/quest-examples.json` + the
website overrides in `lib/quest-prompt.ts`.

## What it scores

`rubric.mjs` is a **deterministic, independent** scorer (it does not import the
route's own detectors — that would be circular). Each batch of quests gets four
0–1 axes, mirroring the project's hard rules:

| axis | rule |
|------|------|
| `foodCap` | at most 1 food quest per batch of 3 (the SKILL's HARD anti-food rule) |
| `diversity` | distinct categories (0.6) + distinct settings (0.4) within the batch |
| `venueLeak` | no proper noun from the scenario's nearby list leaks into output |
| `doability` | concrete action, substantive plan, and not an auto-reject shape |

`composite` is the mean of the four. `aggregate()` averages across scenarios.

## Scenarios

`scenarios.json` holds 15 fixed scenarios spanning cities × group sizes × spice
tiers × category locks × constraints (walking-only, low-cost). Several have
deliberately food-heavy `typeCounts` and proper-noun `nearbyNames` to stress the
food-cap and venue-leak rules.

## Commands

```bash
# Deterministic before/after of the few-shot exemplars themselves
# (the literal prompt content the model imitates). No API key needed.
npm run eval                 # === node eval/run.mjs --exemplars

# Verify the stable few-shot sits inside the prompt-cache breakpoint
npm run eval:cache           # === node eval/check-cache.mjs

# Mine collected ratings to bias the gold set toward 🔥 styles
npm run eval:mine            # === node eval/mine-ratings.mjs

# End-to-end: score live model output from a running dev server.
# Requires the server to have ANTHROPIC_API_KEY (+ Supabase env) set.
npm run dev                  # in one terminal
npm run eval:live            # === node eval/run.mjs --live http://localhost:3000
# add --save eval/fixtures/<dir> to record the batches for reproducible scoring

# Score recorded fixture batches (one <scenario-id>.json per scenario,
# each an array of 3 quests), or diff two recorded sets:
node eval/run.mjs --source eval/fixtures/<dir>
node eval/run.mjs --before eval/fixtures/old --after eval/fixtures/new
```

## Why exemplar scoring is the headline before/after

The few-shot examples are *literal prompt content* the model is told to imitate.
Scoring them with the same rubric is fully reproducible (no sampling, no key)
and directly measures the curation change. The legacy set leaked brand names
(IKEA / Walmart / Home Depot) straight into the exemplars — actively teaching
the model to name venues, which the SKILL forbids. See the PR description for the
before/after table. For full end-to-end batch scoring against the live model,
use `--live` (or record fixtures and use `--source`).
