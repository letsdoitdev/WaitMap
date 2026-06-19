#!/usr/bin/env node
// Lightweight before/after quality check for side-quest generation.
//
// Regenerates a FIXED set of ~10 scenarios (varied cities / group sizes / spice
// tiers) against /api/generate and prints the quests, so you can eyeball
// before-vs-after editing QUALITY_FEEDBACK.md and catch regressions. No rubric,
// no scoring — just deterministic, repeatable scenarios you diff by eye.
//
// Usage:
//   node scripts/quality-check.mjs                 # hits http://localhost:3000
//   BASE_URL=https://<preview>.vercel.app node scripts/quality-check.mjs
//   npm run quality-check
//
// Tip: run it, save the output, edit QUALITY_FEEDBACK.md, redeploy/restart,
// run it again, and diff the two captures.

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);

// Fixed scenarios — the INPUTS are deterministic (model output still varies by
// temperature, which is the point: you're eyeballing whether quality/shape
// shifts after a feedback edit). Spread across spice tiers, group bands,
// geographies (coastal/landlocked/urban/rural), and the cost/drive constraints.
const SCENARIOS = [
  { label: "Austin TX · group · spice 5", body: { location: "Austin, Texas", spiceLevel: 5, groupSize: "group", timeAvailable: 120 } },
  { label: "Ashburn VA · 2 · spice 2", body: { location: "Ashburn, Virginia", spiceLevel: 2, groupSize: "2", timeAvailable: 90 } },
  { label: "Denver CO · group · spice 8", body: { location: "Denver, Colorado", spiceLevel: 8, groupSize: "group", timeAvailable: 180 } },
  { label: "Portland OR · solo · spice 4", body: { location: "Portland, Oregon", spiceLevel: 4, groupSize: "solo", timeAvailable: 60 } },
  { label: "San Diego CA (coastal) · group · spice 6", body: { location: "San Diego, California", spiceLevel: 6, groupSize: "group", timeAvailable: 150 } },
  { label: "rural Montana town · 2 · spice 3", body: { location: "Ekalaka, Montana", spiceLevel: 3, groupSize: "2", timeAvailable: 120 } },
  { label: "New York NY · group · spice 7", body: { location: "New York, New York", spiceLevel: 7, groupSize: "group", timeAvailable: 90 } },
  { label: "Boulder CO · group · spice 2 · walk-only", body: { location: "Boulder, Colorado", spiceLevel: 2, groupSize: "group", timeAvailable: 120, canDrive: false } },
  { label: "Chicago IL · 2 · spice 5 · low-cost", body: { location: "Chicago, Illinois", spiceLevel: 5, groupSize: "2", timeAvailable: 90, lowCostOnly: true } },
  { label: "Miami FL · group · spice 9", body: { location: "Miami, Florida", spiceLevel: 9, groupSize: "group", timeAvailable: 180 } },
];

async function run() {
  console.log(`# quality-check against ${BASE_URL}/api/generate`);
  console.log(`# ${SCENARIOS.length} scenarios · ${new Date().toISOString()}\n`);

  for (const s of SCENARIOS) {
    process.stdout.write(`\n=== ${s.label} ===\n`);
    try {
      const res = await fetch(`${BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // region falls back to location server-side; pass location only so the
        // scenario stays minimal and deterministic.
        body: JSON.stringify(s.body),
      });
      if (!res.ok) {
        console.log(`  [HTTP ${res.status}] ${await res.text().catch(() => "")}`);
        continue;
      }
      const data = await res.json();
      const quests = Array.isArray(data.quests) ? data.quests : [];
      if (quests.length === 0) {
        console.log("  (no quests returned)");
        continue;
      }
      quests.forEach((q, i) => {
        console.log(`  ${i + 1}. [${q.category}/${q.spice}] ${q.title}`);
        console.log(`     ${q.description}`);
      });
    } catch (err) {
      console.log(`  [error] ${err?.message ?? err}`);
    }
  }
  console.log("\n# done");
}

run();
