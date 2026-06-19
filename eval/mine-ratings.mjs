#!/usr/bin/env node
// Mine data/ratings.json for which quest styles score well, so the few-shot
// gold set can be biased toward what users actually rate 🔥.
//
//   node eval/mine-ratings.mjs
//
// Rating scale (lib/ratings.ts): fire=+5, tuff=+2, mid=-1, cooked=-10.
// The miner aggregates net score by category, spice band, and group size and
// prints the winners. It is data-driven: the moment real ratings land in
// data/ratings.json (today it is empty, and on Vercel the runtime FS is
// read-only so server-side ratings rarely persist), this report becomes
// actionable and the gold curation in lib/quest-examples.json can be steered by
// it. Until then it reports "no data" and the curation falls back to the
// SKILL.md rubric.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, "..", "data", "ratings.json");

const SCORE = { fire: 5, tuff: 2, mid: -1, cooked: -10 };

function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function spiceBand(s) {
  if (s <= 3) return "1-3 (chill)";
  if (s <= 6) return "4-6 (mid)";
  if (s <= 8) return "7-8 (spicy)";
  return "9-10 (chaos)";
}

function groupBucket(g) {
  if (g <= 1) return "solo";
  if (g === 2) return "pair";
  return "group (3+)";
}

function tally(records, keyFn) {
  const m = new Map();
  for (const r of records) {
    const k = keyFn(r);
    const cur = m.get(k) ?? { net: 0, n: 0, fire: 0 };
    cur.net += SCORE[r.rating] ?? 0;
    cur.n += 1;
    if (r.rating === "fire") cur.fire += 1;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([k, v]) => ({ key: k, ...v, avg: v.net / v.n }))
    .sort((a, b) => b.avg - a.avg);
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (no data)");
    return;
  }
  for (const r of rows) {
    console.log(`  ${String(r.key).padEnd(16)} avg ${r.avg.toFixed(2).padStart(6)}  net ${String(r.net).padStart(5)}  n=${r.n}  🔥${r.fire}`);
  }
}

const records = load();
console.log(`\n=== RATINGS MINE: ${records.length} records from data/ratings.json ===`);

if (records.length === 0) {
  console.log(`
No collected ratings yet. data/ratings.json is empty.

Why: ratings are stored client-side in localStorage and POSTed to
/api/rate-quest, which writes data/ratings.json — but Vercel's serverless FS is
read-only at runtime, so the file only fills up in local/dev sessions. Until
real data lands, the gold few-shot in lib/quest-examples.json is curated against
the SKILL.md rubric instead.

When data exists, re-run this and bias lib/quest-examples.json toward the
top categories / spice bands / styles reported below.`);
  process.exit(0);
}

printTable("By category (highest avg score first):", tally(records, (r) => r.category));
printTable("By spice band:", tally(records, (r) => spiceBand(r.spiceLevel)));
printTable("By group size:", tally(records, (r) => groupBucket(r.groupSize)));

const fire = records.filter((r) => r.rating === "fire");
if (fire.length) {
  const top = [...fire].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 10);
  console.log("\nRecent 🔥 standouts (candidate gold exemplars):");
  for (const r of top) {
    console.log(`  - "${r.questName}" [${r.category}, spice ${r.spiceLevel}, group ${r.groupSize}]`);
  }
}
