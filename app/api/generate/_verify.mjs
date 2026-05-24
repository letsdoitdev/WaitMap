// Offline verification harness for the M9-revision safety filter +
// title-bigram Jaccard dedup. Run with: `node app/api/generate/_verify.mjs`.
//
// We can't fire 5x4 live generations from this sandbox (no ANTHROPIC_API_KEY,
// no outbound to api.anthropic.com), so this harness verifies the pure
// helpers — the narrowed regex set with allow-phrase exceptions, and the
// Jaccard dedup — against curated cases. Full end-to-end smoke against
// the deployed preview still needs to happen post-deploy.
//
// To keep this script standalone (so it runs in a vanilla Node env with no
// build step), the patterns below are duplicated from route.ts. If you
// edit one, edit both. The duplication is intentional — a runnable
// verifier with zero setup beats a clean import that can't run.

const EMPTY_CART_ALLOW =
  /(open area|empty lot|no one around|nobody around|empty aisle|empty parking lot)/i;
const CONSENT_ALLOW =
  /(with their consent|if they agree|ask(?:ed)? first|with permission|get(?:s|ting)? permission|if they(?:'re| are) cool with it|only if they say yes|opt[- ]?in)/i;

const SAFETY_RULES = [
  {
    name: "library_disruption",
    regex:
      /library.{0,40}(sprint|race|tag|chase|shout|scream|loud|whisper.{0,20}tournament|until staff)/i,
  },
  {
    name: "cart_racing",
    regex: /cart.{0,20}(rider|racing|race|speed.?run)/i,
    allow: (h) => /empty cart/i.test(h) && EMPTY_CART_ALLOW.test(h),
  },
  {
    name: "risky_terrain",
    regex:
      /(cave(?! painting)|spelunk|free.?climb|mountain.?climb|cliff.{0,20}scramble|unmarked trail.{0,30}night)/i,
  },
  {
    name: "filming_stranger_without_consent",
    regex:
      /(film(?:ing)?|record(?:ing)?)\s+(?:a\s+|the\s+|any\s+|random\s+|some\s+|each\s+)?stranger/i,
    allow: (h) => CONSENT_ALLOW.test(h),
  },
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

const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "of", "to", "in", "at", "on", "and", "or", "for", "with", "by",
]);
function titleBigrams(title) {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !TITLE_STOPWORDS.has(t));
  const out = new Set();
  for (let i = 0; i + 1 < tokens.length; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}
function bigramJaccard(a, b) {
  const sa = titleBigrams(a);
  const sb = titleBigrams(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  sa.forEach((t) => {
    if (sb.has(t)) inter++;
  });
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------- Test cases ----------

// Cases that MUST trigger a violation (the 4 ban categories).
const SHOULD_BAN = [
  ["Library Whisper Tournament", "Hit the local library and play a whisper tournament — last to crack up wins."],
  ["Library Tag Loop", "Race through the library aisles tagging each other until staff notices."],
  ["Library Scream-Off", "Inside a library, see who can shout the loudest before being asked to leave."],
  ["Cart Speed Run", "One person rides in the cart, two push, race down the supermarket aisle."],
  ["Aisle Cart Racing", "Cart racing through a crowded supermarket — first to the checkout wins."],
  ["Cart Rider Dash", "Cart with rider inside, race three laps around the store."],
  ["Cave Crawl", "Find an unmarked cave near the trail and crawl as far as you can without lights."],
  ["Free Climb Wall", "Free-climb the rock wall behind the park — no harness, no spotter."],
  ["Cliff Scramble", "Find a cliff and scramble up the loose rock face to the top."],
  ["Mountain Climb Solo", "Mountain climb the rock face solo as far as you can go."],
  ["Unmarked Trail After Dark", "Hit an unmarked trail at night with just phones for light, no map."],
  ["Spelunk Sprint", "Spelunk the closest cave for an hour, no equipment."],
  ["Stranger Film Mission", "Film a stranger answering 5 weird questions, post the best clip."],
  ["Recording Strangers Reel", "Record any stranger's reaction to your group prank and edit it."],
];

// Cases that MUST NOT trigger a violation (allow-phrase exceptions
// and previously-banned-now-allowed patterns).
const SHOULD_PASS = [
  // Cart allow-phrase exception — empty cart in empty area
  ["1am Empty Cart Loop", "Find an empty cart and push it through the empty parking lot at 1am, no one around."],
  ["Empty Aisle Cart Roll", "Late-night store run. Take an empty cart, race down an empty aisle when nobody is around."],
  // Filming with consent
  ["Consent-First Mini Doc", "Film a stranger sharing their favorite local spot — only if they agree first and you ask first."],
  ["Stranger Story Reel", "Record a stranger's story with their consent — ask first, get permission, then hit record."],
  // Previously-banned-now-allowed patterns the user explicitly restored
  ["Fake Name Order Cascade", "Each person walks into the same fast-food spot 5 minutes apart, orders identical food under a different fake name."],
  ["Wrong-Order Swap", "At a restaurant, group orders different items then secretly swap plates before eating."],
  ["Solo Aisle Sprint", "Pick a supermarket aisle. Solo sprint from one end to the other without knocking anything over."],
  ["Cashier Rotation", "Each person pays for one item separately at the same register — confuses the cashier, no harm done."],
  ["Drive-Thru Telephone", "Group rolls up to a drive-thru together. Each person whispers their order to the next, telephone-game style."],
  ["Drive-Thru Race", "Two cars, two drive-thrus across the street from each other. First to finish their order wins."],
  ["Parking Lot Compliment Ambush", "In a busy lot, ambush strangers with the most specific compliments — pure positive vibes."],
  ["Midnight Block Walk", "At midnight, walk 5 unfamiliar blocks in your neighborhood, no destination."],
  ["Before-Dark Neighborhood Map", "Just before dark, walk a new community park you've never been to. Sketch a rough map."],
  ["Suburb Sprint", "Pick a residential street at night, jog the length of it as a group."],
  // Library — non-disruptive
  ["Library Hideout", "Find a quiet library corner. Read for 30 minutes. Trade favorite passages over coffee after."],
  ["Library Random Page", "Find the closest bookstore or library. Pick a book at random. Read the first page out loud as a group."],
  // Cave painting — explicit negative lookahead carve-out
  ["Cave Painting Recreation", "At a local museum, find a cave painting reproduction and sketch it as a group."],
  // Normal outdoor — looks like risky terrain but isn't
  ["Hill Drive", "Drive to the nearest hill. Photograph the city from the top."],
  ["Park Hike", "Hike a marked trail through a community park before dark."],
];

let pass = 0;
let fail = 0;
const failures = [];

console.log("\n[safety] cases that MUST ban:");
for (const [title, desc] of SHOULD_BAN) {
  const v = findSafetyViolation(`${title} ${desc}`);
  if (v) {
    console.log(`  ✓ banned [${v.name}] "${title}"`);
    pass++;
  } else {
    console.log(`  ✗ MISSED  "${title}"`);
    failures.push(`MISSED ban: "${title}"`);
    fail++;
  }
}

console.log("\n[safety] cases that MUST PASS:");
for (const [title, desc] of SHOULD_PASS) {
  const v = findSafetyViolation(`${title} ${desc}`);
  if (!v) {
    console.log(`  ✓ allowed "${title}"`);
    pass++;
  } else {
    console.log(`  ✗ FALSE POSITIVE [${v.name}] "${title}" matched "${v.match}"`);
    failures.push(`FALSE POSITIVE [${v.name}]: "${title}"`);
    fail++;
  }
}

// ---------- Jaccard ----------

console.log("\n[jaccard] exact-collision pairs (must flag, >= 0.45):");
const jaccardBans = [
  ["Street Sign Scavenger Sprint", "Street Sign Scavenger Sprint"],
  ["Highest Point Before Dark", "Highest Point Before Dark"],
  ["Sunrise Stair Race", "Sunrise Stair Race"],
];
for (const [a, b] of jaccardBans) {
  const j = bigramJaccard(a, b);
  if (j >= 0.45) {
    console.log(`  ✓ ${j.toFixed(2)} flag  "${a}" / "${b}"`);
    pass++;
  } else {
    console.log(`  ✗ ${j.toFixed(2)} MISS  "${a}" / "${b}"`);
    failures.push(`Jaccard miss: ${a} / ${b}`);
    fail++;
  }
}

console.log("\n[jaccard] varied pairs (must NOT flag, < 0.45):");
const jaccardOk = [
  ["Sunrise Stair Race", "Polaroid Memory Swap"],
  ["Coffee Shop Question Trade", "Park Picnic Skill Trade"],
  ["Foreign-Language Dub Movie Night", "Rooftop Sky Bingo"],
  ["Stranger Compliment Chain", "Phone Stash Hour"],
];
for (const [a, b] of jaccardOk) {
  const j = bigramJaccard(a, b);
  if (j < 0.45) {
    console.log(`  ✓ ${j.toFixed(2)} ok    "${a}" / "${b}"`);
    pass++;
  } else {
    console.log(`  ✗ ${j.toFixed(2)} FALSE "${a}" / "${b}"`);
    failures.push(`Jaccard false positive: ${a} / ${b}`);
    fail++;
  }
}

console.log(`\n[summary] ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("[summary] failure detail:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("[summary] all clean ✓");
