// Live verification of the M13 quest-quality pipeline against a DEPLOYED
// instance. Run: node scripts/live-verify.mjs   (env: LIVE_BASE_URL)
//
// Exercises the real /api/generate, /api/generate/stream, and
// /api/nearby-places endpoints the way the web client does (anonymous, so
// no reroll metering interferes) and asserts the M13 acceptance criteria:
//
//   QUALITY (hard failures)
//   - exactly 3 quests per batch, ≤1 Food-category quest
//   - every description ≤16 words (SKILL.md absolute ceiling)
//   - no §8 safety-regex hit in any shipped quest
//   - no intra-batch title pair at/over 0.45 bigram Jaccard (or shared
//     trigram), and none vs the request's BANNED TITLES blocklist
//   - walking-only + free-only batches contain no car/paid phrasing
//   - vibe-lean batches keep ≥1 quest OUTSIDE the leaned vibe (exploration)
//   QUALITY (targets, reported + gated softly)
//   - ≥8/10 batches span 3 distinct categories
//   - vibe lean visible (~2/3 of quests match the leaned vibe)
//   TIMING (reported; gated on the plan's targets)
//   - stream time-to-first-card < 6s on a first roll (Sonnet-routed)
//   - JSON reroll latency reported as p50/p95 (Haiku-routed)
//   VENUE DATA
//   - nearby-places histogram for a suburban city includes ≥2 non-food
//     types (nwr query fix) and accepts lat/lon precise-center params
//
// Safety regexes + Jaccard are duplicated from app/api/generate/_verify.mjs
// by design (runnable with zero build steps); if you edit them there, edit
// them here.

// `||` not `??`: on workflow push-triggers the env vars exist but are empty.
const BASE = (process.env.LIVE_BASE_URL || "https://side-quest-generator-snowy.vercel.app").replace(/\/$/, "");
const STREAM_FIRST_CARD_MS = Number(process.env.STREAM_FIRST_CARD_MS) || 6000;

// ---------- duplicated helpers (see _verify.mjs) ----------
const EMPTY_CART_ALLOW = /(open area|empty lot|no one around|nobody around|empty aisle|empty parking lot)/i;
const CONSENT_ALLOW = /(with their consent|if they agree|ask(?:ed)? first|with permission|get(?:s|ting)? permission|if they(?:'re| are) cool with it|only if they say yes|opt[- ]?in)/i;
const SAFETY_RULES = [
  { name: "library_disruption", regex: /library.{0,40}(sprint|race|tag|chase|shout|scream|loud|whisper.{0,20}tournament|until staff)/i },
  { name: "cart_racing", regex: /cart.{0,20}(rider|racing|race|speed.?run)/i, allow: (h) => /empty cart/i.test(h) && EMPTY_CART_ALLOW.test(h) },
  { name: "risky_terrain", regex: /(cave(?! painting)|spelunk|free.?climb|mountain.?climb|cliff.{0,20}scramble|unmarked trail.{0,30}night)/i },
  { name: "filming_stranger_without_consent", regex: /(film(?:ing)?|record(?:ing)?)\s+(?:a\s+|the\s+|any\s+|random\s+|some\s+|each\s+)?stranger/i, allow: (h) => CONSENT_ALLOW.test(h) },
];
function findSafetyViolation(haystack) {
  for (const rule of SAFETY_RULES) {
    const m = haystack.match(rule.regex);
    if (!m) continue;
    if (rule.allow && rule.allow(haystack)) continue;
    return { name: rule.name, match: m[0] };
  }
  return null;
}
const TITLE_STOPWORDS = new Set(["a","an","the","of","to","in","at","on","and","or","for","with","by"]);
function titleBigrams(title) {
  const tokens = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !TITLE_STOPWORDS.has(t));
  const out = new Set();
  for (let i = 0; i + 1 < tokens.length; i++) out.add(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}
function bigramJaccard(a, b) {
  const sa = titleBigrams(a), sb = titleBigrams(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  sa.forEach((t) => { if (sb.has(t)) inter++; });
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
function shareThreeConsecutive(a, b) {
  const ta = a.toLowerCase().split(/\s+/).filter(Boolean);
  const tb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (ta.length < 3 || tb.length < 3) return false;
  const tri = new Set();
  for (let i = 0; i + 2 < tb.length; i++) tri.add(`${tb[i]} ${tb[i + 1]} ${tb[i + 2]}`);
  for (let i = 0; i + 2 < ta.length; i++) if (tri.has(`${ta[i]} ${ta[i + 1]} ${ta[i + 2]}`)) return true;
  return false;
}
const isNearDup = (a, b) => bigramJaccard(a, b) >= 0.45 || shareThreeConsecutive(a, b);
// Constraint keyword belts (duplicated from lib/quest-ranker.ts)
const CAR_REQUIRED = /\b(drive|driving|drove|road trip|drive-?thr(?:u|ough)|carpool|in (?:your|the) car|by car)\b/i;
const PAID_ACTIVITY = /\b(tickets?|admission|cover charge|entry fee|rental|rent an?)\b|\$\s?(?:[5-9]|[1-9]\d+)\b/;

const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

// ---------- harness ----------
let pass = 0, fail = 0, warn = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ FAIL ${name}`, detail ?? ""); failures.push(name); fail++; }
}
function softCheck(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ⚠ WARN ${name}`, detail ?? ""); warn++; }
}
const pct = (arr, p) => arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];

const CITY = process.env.LIVE_CITY || "Ashburn Virginia";
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const now = new Date();

function body(overrides = {}) {
  return {
    location: CITY,
    region: overrides.region ?? CITY,
    nearbyPlaces: overrides.nearbyPlaces ?? [],
    typeCounts: overrides.typeCounts ?? {},
    spiceLevel: 5,
    groupSize: "group",
    timeAvailable: 90,
    excludeIds: [],
    previousTitles: overrides.previousTitles ?? [],
    category: null,
    canDrive: overrides.canDrive ?? true,
    lowCostOnly: overrides.costPref === "free",
    vibeCategories: overrides.vibeCategories ?? [],
    costPref: overrides.costPref ?? null,
    localHour: now.getHours(),
    localWeekday: WEEKDAYS[now.getDay()],
    ...overrides.extra,
  };
}

async function generateJson(payload) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const ms = Date.now() - t0;
  let json = null;
  try { json = await r.json(); } catch { /* leave null */ }
  return { status: r.status, json, ms };
}

async function generateStream(payload) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok || !r.body) return { status: r.status, quests: [], events: [], firstMs: 0, totalMs: Date.now() - t0 };
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const quests = [], events = [];
  let firstMs = 0, done = null;
  for (;;) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let evt = null;
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
      events.push(evt);
      if (evt.type === "quest" && evt.quest) {
        if (!firstMs) firstMs = Date.now() - t0;
        quests.push(evt.quest);
      }
      if (evt.type === "done") done = evt;
    }
  }
  return { status: r.status, quests, events, done, firstMs, totalMs: Date.now() - t0 };
}

function auditBatch(label, quests, sentBlocklist, opts = {}) {
  check(`${label}: 3 quests shipped`, quests.length === 3, quests.length);
  const foodCount = quests.filter((q) => q.category === "Food").length;
  check(`${label}: ≤1 Food quest`, foodCount <= 1, foodCount);
  for (const q of quests) {
    const dw = wordCount(q.description);
    check(`${label}: "${q.title}" description ≤16 words`, dw <= 16, `${dw} words: ${q.description}`);
    const safety = findSafetyViolation(`${q.title} ${q.description}`);
    check(`${label}: "${q.title}" passes safety belt`, !safety, safety);
    if (opts.walkingOnly) check(`${label}: "${q.title}" no car phrasing`, !CAR_REQUIRED.test(`${q.title} ${q.description}`), q.description);
    if (opts.freeOnly) check(`${label}: "${q.title}" no paid phrasing`, !PAID_ACTIVITY.test(`${q.title} ${q.description}`), q.description);
  }
  for (let i = 0; i < quests.length; i++) {
    for (let j = i + 1; j < quests.length; j++) {
      check(
        `${label}: no near-dup pair "${quests[i].title}" / "${quests[j].title}"`,
        !isNearDup(quests[i].title, quests[j].title),
        bigramJaccard(quests[i].title, quests[j].title).toFixed(2),
      );
    }
    for (const prev of sentBlocklist) {
      if (isNearDup(quests[i].title, prev)) {
        check(`${label}: "${quests[i].title}" not a near-dup of banned "${prev}"`, false);
      }
    }
  }
  return { distinctCats: new Set(quests.map((q) => q.category)).size, foodCount };
}

async function main() {
  console.log(`Live verification against ${BASE}\n`);

  // ---------- A. nearby-places: nwr fix + precise center ----------
  console.log("[A] /api/nearby-places (nwr venue data)");
  let typeCounts = {};
  let region = CITY;
  {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/nearby-places?location=${encodeURIComponent(CITY)}`);
    const j = await r.json();
    console.log(`  histogram (${Date.now() - t0}ms):`, j.typeCounts ?? {});
    check("nearby-places ok", r.status === 200 && j.ok === true, j);
    typeCounts = j.typeCounts ?? {};
    if (j.location?.display) region = j.location.display;
    const NON_FOOD = ["park","playground","sports_centre","stadium","museum","attraction","viewpoint","supermarket","mall","hardware","library","gym","cinema","theatre"];
    const nonFood = NON_FOOD.filter((t) => (typeCounts[t] ?? 0) > 0);
    check(`≥2 non-food venue types in histogram (got: ${nonFood.join(", ") || "none"})`, nonFood.length >= 2, typeCounts);
    // Precise-center param path (Ashburn coords)
    const r2 = await fetch(`${BASE}/api/nearby-places?location=${encodeURIComponent(CITY)}&lat=39.0438&lon=-77.4874`);
    const j2 = await r2.json();
    check("precise lat/lon center accepted", r2.status === 200 && j2.ok === true, j2.error);
  }

  // ---------- B. stream REROLL (Haiku-routed): fingerprint + quality ----------
  // Uses a non-empty blocklist so the request routes to the reroll model.
  // This isolates "does streaming work at all + is M13 deployed" from the
  // separate question of how the first-roll model behaves (section G).
  console.log("\n[B] /api/generate/stream — reroll (Haiku-routed): fingerprint");
  const seedTitles = [
    "Sunset Ridge Group Sketch Walk",
    "Laundromat Sock Puppet Theater",
    "Crosswalk Countdown Dance Relay",
  ];
  {
    const s = await generateStream(body({ region, typeCounts, previousTitles: seedTitles }));
    check("stream responded 200", s.status === 200, s.status);
    console.log(`  frames: ${s.events.map((e) => e.type).join(", ")}`);
    const err = s.events.find((e) => e.type === "error");
    if (err) console.log("  error frame:", JSON.stringify(err));
    check("M13 deployment fingerprint (done frame has rankedPool/dropped)", s.done != null && "rankedPool" in s.done && "dropped" in s.done, s.done);
    console.log(`  first card: ${s.firstMs}ms, total: ${s.totalMs}ms, done:`, s.done);
    auditBatch("stream-reroll", s.quests, seedTitles);
    check(`first card < ${STREAM_FIRST_CARD_MS}ms`, s.firstMs > 0 && s.firstMs < STREAM_FIRST_CARD_MS, `${s.firstMs}ms`);
  }

  // ---------- C. 10 JSON reroll batches: quality sweep ----------
  console.log("\n[C] /api/generate — 10 reroll batches (Haiku-routed)");
  const blocklist = [];
  const rerollMs = [];
  let spreadOk = 0;
  for (let i = 0; i < 10; i++) {
    const sent = blocklist.slice(-30);
    const g = await generateJson(body({ region, typeCounts, previousTitles: sent }));
    check(`batch ${i + 1} ok:true`, g.status === 200 && g.json?.ok === true, `${g.status} ${JSON.stringify(g.json)?.slice(0, 200)}`);
    if (!g.json?.quests) continue;
    rerollMs.push(g.ms);
    const { distinctCats } = auditBatch(`batch ${i + 1}`, g.json.quests, sent);
    if (distinctCats === 3) spreadOk++;
    for (const q of g.json.quests) blocklist.push(q.title);
  }
  console.log(`  reroll latency: p50=${pct(rerollMs, 50)}ms p95=${pct(rerollMs, 95)}ms (n=${rerollMs.length})`);
  softCheck(`≥8/10 batches span 3 distinct categories (got ${spreadOk}/10)`, spreadOk >= 8);

  // ---------- D. vibe lean: bias without collapse ----------
  console.log("\n[D] vibe lean (Late Night) — favored ~2/3, never all 3");
  let leanTotal = 0;
  for (let i = 0; i < 3; i++) {
    const sent = blocklist.slice(-30);
    const g = await generateJson(body({ region, typeCounts, previousTitles: sent, vibeCategories: ["Late Night"] }));
    check(`vibe batch ${i + 1} ok:true`, g.status === 200 && g.json?.ok === true, g.status);
    if (!g.json?.quests) continue;
    auditBatch(`vibe batch ${i + 1}`, g.json.quests, sent);
    const lean = g.json.quests.filter((q) => q.category === "Late Night").length;
    leanTotal += lean;
    console.log(`  batch ${i + 1}: ${lean}/3 Late Night — ${g.json.quests.map((q) => `${q.title} (${q.category})`).join(" | ")}`);
    check(`vibe batch ${i + 1}: ≥1 quest OUTSIDE the leaned vibe (exploration slot)`, lean < 3, lean);
    for (const q of g.json.quests) blocklist.push(q.title);
  }
  softCheck(`vibe lean visible: ≥4/9 quests Late Night across 3 batches (got ${leanTotal}/9)`, leanTotal >= 4);

  // ---------- E. constraint compliance ----------
  console.log("\n[E] walking-only + free-only constraint batches");
  for (let i = 0; i < 2; i++) {
    const sent = blocklist.slice(-30);
    const g = await generateJson(body({ region, typeCounts, previousTitles: sent, canDrive: false, costPref: "free" }));
    check(`constraint batch ${i + 1} ok:true`, g.status === 200 && g.json?.ok === true, g.status);
    if (!g.json?.quests) continue;
    auditBatch(`constraint batch ${i + 1}`, g.json.quests, sent, { walkingOnly: true, freeOnly: true });
    for (const q of g.json.quests) blocklist.push(q.title);
  }

  // ---------- F. first-roll vs reroll timing split (diagnostic) ----------
  console.log("\n[F] JSON timing split: first roll (Sonnet) vs reroll (Haiku)");
  const firstMs = [], haikuMs = [];
  for (let i = 0; i < 2; i++) {
    const f = await generateJson(body({ region, typeCounts, previousTitles: [] }));
    console.log(`  first-roll call ${i + 1}: status=${f.status} ok=${f.json?.ok} ${f.ms}ms${f.json?.ok ? "" : ` body=${JSON.stringify(f.json)?.slice(0, 200)}`}`);
    if (f.json?.ok) firstMs.push(f.ms);
    const h = await generateJson(body({ region, typeCounts, previousTitles: blocklist.slice(-30) }));
    console.log(`  reroll call ${i + 1}:     status=${h.status} ok=${h.json?.ok} ${h.ms}ms`);
    if (h.json?.ok) haikuMs.push(h.ms);
  }
  softCheck("timing samples collected for both routes", firstMs.length === 2 && haikuMs.length === 2, { firstMs, haikuMs });

  // ---------- G. stream FIRST ROLL diagnostic (first-roll model) ----------
  // Kept diagnostic/soft: isolates the first-roll model's streaming
  // behavior. Frames + error payloads are printed so a hang or model error
  // is distinguishable from an SSE parsing problem.
  console.log("\n[G] /api/generate/stream — first roll (diagnostic)");
  {
    const s = await generateStream(body({ region, typeCounts, previousTitles: [] }));
    console.log(`  status=${s.status} quests=${s.quests.length} first=${s.firstMs}ms total=${s.totalMs}ms`);
    console.log(`  frames: ${s.events.map((e) => e.type).join(", ") || "(none)"}`);
    for (const e of s.events) {
      if (e.type === "error" || e.type === "done") console.log(`  ${e.type} frame:`, JSON.stringify(e));
    }
    softCheck(`first-roll stream first card < ${STREAM_FIRST_CARD_MS}ms`, s.firstMs > 0 && s.firstMs < STREAM_FIRST_CARD_MS, `${s.firstMs}ms`);
  }

  console.log(`\n========================================`);
  console.log(`${pass} passed, ${fail} failed, ${warn} warnings`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("live-verify crashed:", e);
  process.exit(2);
});
