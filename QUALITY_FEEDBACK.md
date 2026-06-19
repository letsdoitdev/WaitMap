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

## KILL
