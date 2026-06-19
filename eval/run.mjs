#!/usr/bin/env node
// Eval harness runner for the side-quest generator.
//
// Modes:
//   node eval/run.mjs --exemplars
//       Score the few-shot GOLD exemplars themselves (old vs new) with the
//       rubric. Fully deterministic, needs no API key — this is the
//       reproducible before/after for the few-shot curation change, since the
//       exemplars are literal prompt content the model imitates.
//
//   node eval/run.mjs --source eval/fixtures/<dir>
//       Score recorded batch fixtures. Each <id>.json is an array of 3 quests
//       matched to a scenario by filename === scenario id. Use this to score a
//       captured "before" vs "after" set of model outputs reproducibly.
//
//   node eval/run.mjs --live http://localhost:3000
//       POST every scenario to a running dev server's /api/generate and score
//       the live responses. Requires ANTHROPIC_API_KEY (+ Supabase env) set
//       for that server. Optionally pass --save eval/fixtures/<dir> to record.
//
// Default (no flags): runs --exemplars.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scoreBatch, aggregate } from "./rubric.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Brand proper nouns used as the leak list when scoring exemplars (which have
// no per-scenario nearby list). Catches the old set's Walmart/IKEA/Home Depot.
const BRANDS = [
  "Walmart", "IKEA", "Home Depot", "Target", "Costco", "Starbucks",
  "McDonald's", "Trader Joe's", "Whole Foods", "Best Buy", "Lowe's",
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function pct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function fmtAxes(a) {
  return `food ${pct(a.foodCap)} | div ${pct(a.diversity)} | leak ${pct(a.venueLeak)} | do ${pct(a.doability)}`;
}

// --- exemplar mode -----------------------------------------------------------
function loadExemplarSets() {
  const newSet = readJson(path.join(ROOT, "lib", "quest-examples.json"));
  const legacy = readJson(path.join(__dirname, "fixtures", "legacy-fewshot.json"));
  return { legacy, newSet };
}

function scoreExemplarSet(fewShotGold) {
  const results = [];
  for (const tier of fewShotGold) {
    const batch = tier.examples.map((e) => ({
      title: e.title,
      description: e.description,
      category: e.category ?? "?",
    }));
    const r = scoreBatch(batch, BRANDS);
    results.push({ label: `Tier ${tier.tier}`, ...r });
  }
  return results;
}

function runExemplars() {
  const { legacy, newSet } = loadExemplarSets();
  const before = scoreExemplarSet(legacy.fewShotGold);
  const after = scoreExemplarSet(newSet.fewShotGold);
  const beforeAgg = aggregate(before);
  const afterAgg = aggregate(after);

  console.log("\n=== EXEMPLAR SCORING (deterministic; the few-shot the model imitates) ===\n");
  console.log("BEFORE (legacy 3-tier branded set):");
  for (const r of before) {
    console.log(`  ${r.label.padEnd(8)} composite ${pct(r.composite).padStart(4)}  ${fmtAxes(r.axes)}${r.details.leaks.length ? `  LEAKS: ${r.details.leaks.join(", ")}` : ""}`);
  }
  console.log(`  ${"AVG".padEnd(8)} composite ${pct(beforeAgg.composite).padStart(4)}  ${fmtAxes(beforeAgg.axes)}`);

  console.log("\nAFTER (curated 4-tier generic-anchor set):");
  for (const r of after) {
    console.log(`  ${r.label.padEnd(8)} composite ${pct(r.composite).padStart(4)}  ${fmtAxes(r.axes)}${r.details.leaks.length ? `  LEAKS: ${r.details.leaks.join(", ")}` : ""}`);
  }
  console.log(`  ${"AVG".padEnd(8)} composite ${pct(afterAgg.composite).padStart(4)}  ${fmtAxes(afterAgg.axes)}`);

  // Negative-example coverage of the named failure modes.
  const wantModes = [
    "synchronized-performance",
    "food-in-body",
    "code-name",
    "venue-name",
  ];
  const have = (newSet.negativeExamples ?? []).map((n) => n.failureMode.toLowerCase());
  const covered = wantModes.filter((m) => have.some((h) => h.includes(m.split("-")[0])));
  console.log(`\nNegative-example coverage of named failure modes: ${covered.length}/${wantModes.length} (before: 0 structured — legacy had a flat generic list).`);

  printDelta(beforeAgg, afterAgg);
  return { before: beforeAgg, after: afterAgg };
}

// --- fixture / live batch mode ----------------------------------------------
function scoreScenarioBatches(getBatch, label) {
  const { scenarios } = readJson(path.join(__dirname, "scenarios.json"));
  const results = [];
  for (const sc of scenarios) {
    const batch = getBatch(sc);
    if (!batch) continue;
    const r = scoreBatch(batch, sc.nearbyNames ?? []);
    results.push({ id: sc.id, spice: sc.body.spiceLevel, ...r });
  }
  const agg = aggregate(results);
  console.log(`\n=== ${label} (${results.length} scenarios) ===\n`);
  for (const r of results) {
    const flags = [];
    if (r.details.leaks.length) flags.push(`leaks:${r.details.leaks.join("/")}`);
    if (r.details.foodCount > 1) flags.push(`food:${r.details.foodCount}`);
    if (r.details.undoable.length) flags.push(`undoable:${r.details.undoable.length}`);
    console.log(`  ${r.id.padEnd(34)} sp${String(r.spice).padStart(2)}  ${pct(r.composite).padStart(4)}  ${fmtAxes(r.axes)}${flags.length ? `  [${flags.join(" ")}]` : ""}`);
  }
  console.log(`  ${"AVG".padEnd(34)}       ${pct(agg.composite).padStart(4)}  ${fmtAxes(agg.axes)}`);
  return agg;
}

function runFixtures(dir) {
  const abs = path.isAbsolute(dir) ? dir : path.join(ROOT, dir);
  return scoreScenarioBatches((sc) => {
    const f = path.join(abs, `${sc.id}.json`);
    if (!fs.existsSync(f)) return null;
    return readJson(f);
  }, `FIXTURE SCORING: ${dir}`);
}

async function runLive(baseUrl, saveDir) {
  const { scenarios } = readJson(path.join(__dirname, "scenarios.json"));
  const batches = {};
  for (const sc of scenarios) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sc.body),
      });
      const data = await res.json();
      const quests = (data.quests ?? []).map((q) => ({
        title: q.title,
        description: q.description,
        category: q.category,
      }));
      batches[sc.id] = quests;
      if (saveDir) {
        const abs = path.isAbsolute(saveDir) ? saveDir : path.join(ROOT, saveDir);
        fs.mkdirSync(abs, { recursive: true });
        fs.writeFileSync(path.join(abs, `${sc.id}.json`), JSON.stringify(quests, null, 2));
      }
      console.log(`  fetched ${sc.id} (${quests.length} quests)`);
    } catch (e) {
      console.log(`  FAILED ${sc.id}: ${e.message}`);
    }
  }
  return scoreScenarioBatches((sc) => batches[sc.id] ?? null, `LIVE SCORING: ${baseUrl}`);
}

function printDelta(before, after) {
  const row = (k, b, a) =>
    `  ${k.padEnd(11)} ${pct(b).padStart(5)} -> ${pct(a).padStart(5)}  (${a - b >= 0 ? "+" : ""}${((a - b) * 100).toFixed(0)} pts)`;
  console.log("\n--- BEFORE -> AFTER ---");
  console.log(row("composite", before.composite, after.composite));
  console.log(row("foodCap", before.axes.foodCap, after.axes.foodCap));
  console.log(row("diversity", before.axes.diversity, after.axes.diversity));
  console.log(row("venueLeak", before.axes.venueLeak, after.axes.venueLeak));
  console.log(row("doability", before.axes.doability, after.axes.doability));
}

// --- main --------------------------------------------------------------------
const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? true) : null;
}

(async () => {
  if (flag("--live")) {
    await runLive(flag("--live"), flag("--save"));
  } else if (flag("--source")) {
    runFixtures(flag("--source"));
  } else if (flag("--before") && flag("--after")) {
    const before = runFixtures(flag("--before"));
    const after = runFixtures(flag("--after"));
    printDelta(before, after);
  } else {
    runExemplars();
  }
})();
