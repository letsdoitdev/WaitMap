// Offline verification harness for the M9-revision safety filter +
// title-bigram Jaccard dedup + the prop/mechanic anti-fixation belt.
// Run with: `node app/api/generate/_verify.mjs`.
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

// ============================================================================
// TEST FIXTURES ONLY — NOT EXEMPLARS.
// Do NOT distill or copy quests from this file; every quest string below
// (here and in later fixture blocks) exists solely to exercise the
// verifier's regexes and pipeline logic. Many are deliberately BAD or
// deliberately stale-patterned (relays, chalk, multi-venue errands) so the
// checks have something to catch. Treat all of them as radioactive for
// SKILL.md / prompt / KEEP-list distillation purposes.
// ============================================================================

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

// ---------- Prop / mechanic anti-fixation belt ----------
// Duplicated from lib/quest-ranker.ts (same edit-both rule as the safety
// patterns above).

const MECHANIC_FAMILIES = [
  {
    name: "relay",
    regex:
      /\brelay\b|\bpass(?:es|ing)?\s+(?:it|them|the\s+\w+)\s+(?:down|along|to\s+the\s+next)\b|\bhand(?:s|ing)?\s+(?:it|them|the\s+\w+)\s+(?:off|to\s+the\s+next)\b|\btak(?:e|es|ing)\s+turns\s+adding\b/i,
  },
  {
    name: "decode",
    regex:
      /\b(?:decode|decoding|decipher|encoded|cipher|hidden\s+(?:message|note|clue)|secret\s+(?:message|code|note)|coded\s+(?:message|note|clue))\b/i,
  },
  {
    name: "silent",
    regex:
      /\b(?:silent|silently|silence|without\s+(?:talking|speaking|words|saying)|no\s+(?:talking|speaking)|gestures?\s+only|only\s+gestures|mime|miming)\b/i,
  },
  {
    name: "photo_count",
    regex:
      /\b(?:photograph|photo|snap|picture)\w*\b[^.!?]{0,40}\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\b[^.!?]{0,25}\b(?:photos?|photographs?|pictures?|snaps?)\b/i,
  },
  {
    name: "navigate_blind",
    regex:
      /\b(?:blindfold(?:ed)?|walk(?:s|ing)?\s+backwards?|navigate\w*[^.!?]{0,30}\b(?:backwards?|blind|landmarks?\s+only|without\s+(?:gps|a\s+map|maps|phones?))|by\s+landmarks?\s+only|eyes\s+closed)\b/i,
  },
];

function detectMechanics(text) {
  const out = [];
  for (const f of MECHANIC_FAMILIES) {
    if (f.regex.test(text)) out.push(f.name);
  }
  return out;
}

const ANCHOR_STOPWORDS = new Set([
  "the", "and", "but", "nor", "with", "without", "from", "into", "onto",
  "over", "under", "down", "out", "off", "that", "these", "those", "this",
  "your", "yours", "their", "them", "they", "then", "than", "each", "every",
  "all", "any", "some", "none", "nothing", "only", "just", "most", "more",
  "least", "less", "own", "same", "other", "another", "both", "either",
  "neither", "while", "until", "before", "after", "during", "once", "twice",
  "again", "still", "ever", "never", "also", "even", "like", "via", "per",
  "instead", "together", "apart", "exactly", "about", "against", "through",
  "between", "behind", "across", "toward", "towards", "along", "around",
  "inside", "outside", "someone", "something", "anything", "everything",
  "whoever", "whatever", "whichever", "where", "when", "what", "here",
  "there", "back", "away", "left", "right", "near", "nearby", "local",
  "group", "crew", "everyone", "everybody", "anyone", "friend", "people",
  "person", "member", "team", "partner", "player", "opponent", "side",
  "pair", "solo", "whole", "gang", "squad", "passerby", "passersby",
  "quest", "challenge", "game", "mission", "adventure", "contest",
  "tournament", "showdown", "battle", "round", "level", "rule", "turn",
  "point", "score", "scored", "scoring", "win", "winner", "winning", "lose",
  "loser", "losing", "prize", "stake", "bet", "wager", "goal", "task",
  "edition", "mode",
  "photo", "photograph", "picture", "selfie", "video", "clip", "film",
  "camera", "phone", "screen", "proof", "evidence", "shot", "recap",
  "park", "street", "store", "shop", "spot", "place", "corner", "block",
  "neighborhood", "town", "city", "home", "house", "apartment", "room",
  "aisle", "area", "venue", "location", "cafe", "restaurant", "mall",
  "market", "supermarket", "library", "museum", "playground", "cinema",
  "theater", "theatre", "station", "sidewalk", "entrance", "exit", "door",
  "indoor", "indoors", "outdoor", "outdoors", "public",
  "minute", "hour", "second", "time", "today", "tonight", "night", "day",
  "week", "weekend", "morning", "afternoon", "evening", "midnight",
  "find", "walk", "make", "take", "get", "give", "going", "turn", "pick",
  "play", "start", "end", "meet", "try", "use", "see", "watch", "look",
  "tell", "say", "ask", "keep", "hold", "put", "set", "let", "send",
  "bring", "choose", "grab", "head", "run", "race", "chase", "sprint",
  "visit", "order", "buy", "pay", "eat", "drink", "snap", "count", "swap",
  "trade", "guess", "draw", "hide", "hunt", "build", "stack", "climb",
  "read", "write", "share", "shared", "sharing", "begin", "begins",
  "finish", "finishes", "complete", "completes", "return", "returns",
  "arrive", "arrives", "leave", "leaves", "stay", "stays", "stop", "stops",
  "wait", "waits", "declare", "declares", "crown", "crowned", "crowns",
  "vote", "votes", "voting", "judge", "judged", "judging", "rate", "rated",
  "rating",
  "new", "old", "first", "last", "next", "best", "worst", "random",
  "secret", "hidden", "full", "half", "single", "double", "triple",
  "couple", "dozen", "entire", "total", "final", "finally", "weird",
  "weirdest", "wild", "wildest", "crazy", "craziest", "silly", "silliest",
  "funny", "funniest", "fast", "fastest", "slow", "slowest", "tall",
  "tallest", "big", "biggest", "small", "smallest", "long", "longest",
  "short", "shortest", "high", "highest", "low", "lowest", "close",
  "closest", "nearest", "deep", "deepest", "cheap", "cheapest", "quiet",
  "loud", "free", "real", "fake", "perfect", "favorite",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten",
  "thing", "item", "object", "stuff", "way", "route", "path", "word",
  "line", "list", "money", "dollar", "buck", "hand", "hands", "foot",
  "feet", "eye", "eyes", "face", "voice", "body", "staff",
]);

function anchorTokens(text) {
  const out = new Set();
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const t = raw.replace(/'/g, "");
    if (t.length < 4 || ANCHOR_STOPWORDS.has(t)) continue;
    const sing =
      t.length > 4 && t.endsWith("s") && !t.endsWith("ss")
        ? t.slice(0, -1)
        : t;
    if (ANCHOR_STOPWORDS.has(sing)) continue;
    out.add(sing);
  }
  return out;
}

function findBatchConflict(candidate, kept) {
  const text = `${candidate.title} ${candidate.description}`;
  const anchors = anchorTokens(text);
  const mechanics = detectMechanics(text);
  for (const k of kept) {
    const kText = `${k.title} ${k.description ?? ""}`;
    const kAnchors = anchorTokens(kText);
    for (const a of anchors) {
      if (kAnchors.has(a)) {
        return { reason: "duplicate_prop", shared: a, withTitle: k.title };
      }
    }
    if (mechanics.length > 0) {
      const kMechanics = new Set(detectMechanics(kText));
      for (const m of mechanics) {
        if (kMechanics.has(m)) {
          return { reason: "duplicate_mechanic", shared: m, withTitle: k.title };
        }
      }
    }
  }
  return null;
}

const q = (title, description) => ({ title, description });

// (Fixtures — see the NOT-EXEMPLARS banner above.)
// Pairs that MUST conflict — the observed fixation patterns: one central
// prop told through different structural shapes, or one stock mechanic
// reused across siblings.
const MUST_CONFLICT = [
  // single-prop fixation (different shapes, same anchor noun)
  [q("Chalk Bet Showdown", "Bet on who draws the best chalk doodle outside."),
   q("Chalk Portrait Gauntlet", "Sketch each other in chalk, strangers judge the best one.")],
  [q("Balloon Debate Club", "Argue absurd topics while keeping a balloon airborne."),
   q("Balloon Tower Build", "Stack balloons into the tallest tower that stands ten seconds.")],
  [q("Storefront Cipher Hunt", "Decode a hidden message spelled by storefront signs."),
   q("Storefront Color Collection", "Photograph five storefronts in rainbow order before sunset.")],
  // stock-mechanic repetition (different props, same engine)
  [q("Sock Relay Sprint", "Relay a rolled sock across the park without using hands."),
   q("Pinecone Relay Loop", "Relay a pinecone around the block, last leg walks backwards.")],
  [q("Menu Cipher Night", "Decode a secret message hidden in a takeout menu."),
   q("Sidewalk Code Drop", "Plant a coded note for the crew to decipher.")],
  [q("Mime the Order Round", "Order snacks using only gestures, no talking allowed."),
   q("Silent Park Olympics", "Compete in mini games in total silence, first laugh loses.")],
  [q("Snap Five Doors Dash", "Photograph five green doors before the timer dies."),
   q("Ten Dogs Camera Hunt", "Snap ten different dogs, weirdest leash wins it all.")],
  [q("Backwards Block Guide", "Guide a blindfolded friend around the block by voice."),
   q("Landmark Only Trek", "Navigate home by landmarks only, phones stay zipped away.")],
];

// Pairs that MUST NOT conflict — distinct props and mechanics, plus pairs
// sharing only generic quest vocabulary (winner/route/proof-photo/etc.).
const MUST_NOT_CONFLICT = [
  [q("Sunrise Hill Cocoa Mission", "Hike the nearest hill for sunrise, thermos cocoa at the top."),
   q("Cardboard Fort Build-Off", "Build a couch fort from cardboard, hold a housewarming.")],
  [q("Wrong Skill Level Pickup", "Join a pickup game way above your level, celebrate every point."),
   q("Thrift Store Outfit Oracle", "Style each other blind from thrift racks, wear it out.")],
  // shared generic stake phrasing must not read as a shared prop
  [q("Alley Bocce Invitational", "Roll oranges at a target, winner picks the route home."),
   q("Stairwell Echo Choir", "Harmonize one chord in a stairwell, winner picks the route home.")],
  // a single proof photo is not the photo-count mechanic
  [q("Fountain Coin Diplomacy", "Trade wishes out loud, seal the best with a group photo."),
   q("Grandma Recipe Roulette", "Cook one random family recipe from memory, plate it fancy.")],
];

console.log("\n[anti-fixation] pairs that MUST conflict:");
for (const [a, b] of MUST_CONFLICT) {
  const c = findBatchConflict(b, [a]);
  if (c) {
    console.log(`  ✓ ${c.reason} (${c.shared}) "${a.title}" / "${b.title}"`);
    pass++;
  } else {
    console.log(`  ✗ MISSED  "${a.title}" / "${b.title}"`);
    failures.push(`Anti-fixation miss: ${a.title} / ${b.title}`);
    fail++;
  }
}

console.log("\n[anti-fixation] pairs that MUST NOT conflict:");
for (const [a, b] of MUST_NOT_CONFLICT) {
  const c = findBatchConflict(b, [a]);
  if (!c) {
    console.log(`  ✓ ok      "${a.title}" / "${b.title}"`);
    pass++;
  } else {
    console.log(
      `  ✗ FALSE ${c.reason} (${c.shared}) "${a.title}" / "${b.title}"`,
    );
    failures.push(
      `Anti-fixation false positive (${c.reason}:${c.shared}): ${a.title} / ${b.title}`,
    );
    fail++;
  }
}

console.log("\n[mechanics] single-quest detection sanity:");
const MECHANIC_CASES = [
  ["Race to photograph five murals before dark.", ["photo_count"]],
  ["Snap one group photo at the summit as proof.", []],
  ["Walk the whole loop without talking once.", ["silent"]],
  ["Find the viewpoint with no GPS, paper map allowed.", []],
];
for (const [text, expected] of MECHANIC_CASES) {
  const got = detectMechanics(text);
  const okCase =
    got.length === expected.length && expected.every((m) => got.includes(m));
  if (okCase) {
    console.log(`  ✓ [${got.join(",") || "none"}] "${text}"`);
    pass++;
  } else {
    console.log(
      `  ✗ got [${got.join(",")}] want [${expected.join(",")}] "${text}"`,
    );
    failures.push(`Mechanic detect: "${text}"`);
    fail++;
  }
}

// ---------- Interest registers (two-axis grid) ----------
// Duplicated from lib/quest-ranker.ts (same edit-both rule).

const REGISTER_PATTERNS = [
  {
    name: "social-performative",
    regex:
      /\b(?:cashier|employee|clerk|barista|staff|strangers?|deadpan|in[- ]character|role[- ]?play\w*|accent|persona|improv|perform\w*|convince|persuade|audience)\b/i,
  },
  {
    name: "cerebral-puzzle",
    regex:
      /\b(?:puzzle|riddle|deduc\w+|estimat\w+|memori[sz]e|memory|trivia|quiz|logic|mystery|clues?|decode|cipher|guess\w*)\b/i,
  },
  {
    name: "creative-maker",
    regex:
      /\b(?:build\w*|sketch\w*|draw\w*|doodle\w*|craft\w*|design\w*|compose|invent\w*|assembl\w+|sculpt\w*|fold\w*|paint\w*|decorate|collage|origami)\b/i,
  },
  {
    name: "sensory-cozy",
    regex:
      /\b(?:sunrise|sunset|stargaz\w+|cozy|calm\w*|quiet\w*|listen\w*|playlist|blanket|breeze|clouds?|savor\w*|golden hour|ambient)\b/i,
  },
  {
    name: "exploratory-discovery",
    regex:
      /\b(?:explor\w+|wander\w*|discover\w*|unfamiliar|uncharted|scout\w*|roam\w*|trek\w*|never (?:been|visited)|new[- ]to[- ]you)\b/i,
  },
  {
    name: "competitive",
    regex:
      /\b(?:tournament|bracket|best[- ]of[- ]\w+|head[- ]to[- ]head|duel|showdown|face[- ]off|1v1|versus|champion\w*|wager|bets?)\b/i,
  },
  {
    name: "active-physical",
    regex:
      /\b(?:sprint\w*|climb\w*|hik\w+|jog\w*|laps?|stairs|balanc\w+|obstacle|parkour|rac(?:e|es|ing)|dash|throw\w*|catch|kick\w*|jump\w*|carry\w*|piggyback)\b/i,
  },
];

function detectRegister(text) {
  for (const r of REGISTER_PATTERNS) {
    if (r.regex.test(text)) return r.name;
  }
  return null;
}

// Constraint-feasibility belts, duplicated from lib/quest-ranker.ts.
const CAR_REQUIRED =
  /\b(drive|driving|drove|road trip|drive-?thr(?:u|ough)|carpool|in (?:your|the) car|by car)\b/i;
const PAID_ACTIVITY =
  /\b(tickets?|admission|cover charge|entry fee|rental|rent an?)\b|\$\s?(?:[5-9]|[1-9]\d+)\b/;

console.log("\n[registers] detection sanity:");
const REGISTER_CASES = [
  ["Stairwell Interval Ladder", "Sprint the stairwell in laps, each round adds a floor.", "active-physical"],
  ["Fake Art Docents Takeover", "Roam a gallery in character as deadpan docents until someone asks.", "social-performative"],
  ["Parking Meter Estimation Duel", "Estimate odd quantities around you, verify each guess on the spot.", "cerebral-puzzle"],
  ["Pocket Junk Sculpture Show", "Sculpt tiny statues from pocket junk, unveil them gallery-style.", "creative-maker"],
  ["Golden Hour Cloud Cinema", "Lie back and narrate clouds until the golden hour fades.", "sensory-cozy"],
  ["Coin Flip Street Roulette", "Wander with a coin picking every turn until somewhere unfamiliar.", "exploratory-discovery"],
  ["Bottle Cap Flick Championship", "Face off in a bottle cap flicking tournament, crown a champion.", "competitive"],
  ["Totally Plain Evening Errand", "Do the errand together and head back.", null],
];
for (const [title, desc, expected] of REGISTER_CASES) {
  const got = detectRegister(`${title} ${desc}`);
  if (got === expected) {
    console.log(`  ✓ ${got ?? "null"} "${title}"`);
    pass++;
  } else {
    console.log(`  ✗ got ${got} want ${expected} "${title}"`);
    failures.push(`Register detect: "${title}"`);
    fail++;
  }
}

// End-to-end batch check: a 6-candidate pool goes through the duplicated
// hard-filter (safety + prop/mechanic conflicts), then a register-spread
// greedy pick (mirroring selectTopQuests' tiebreaker). The shipped batch
// must (a) still hold 3 quests, (b) span 3 DISTINCT registers, and
// (c) pass safety + walking-only/free-only feasibility.
console.log("\n[registers] batch pipeline (3 shipped, 3 distinct registers, safe/feasible):");
const BATCH_POOL = [
  q("Stairwell Interval Ladder", "Sprint the stairwell in laps, each round adds a floor."),
  q("Lobby Sprint Ladder Rematch", "Sprint lobby laps again, one more floor every round."),
  q("Parking Meter Estimation Duel", "Estimate odd quantities around you, verify each guess on the spot."),
  q("Pocket Junk Sculpture Show", "Sculpt tiny statues from pocket junk, unveil them gallery-style."),
  q("Golden Hour Cloud Cinema", "Lie back and narrate clouds until the golden hour fades."),
  q("Coin Flip Street Roulette", "Wander with a coin picking every turn until somewhere unfamiliar."),
];
{
  const kept = [];
  for (const cand of BATCH_POOL) {
    if (findSafetyViolation(`${cand.title} ${cand.description}`)) continue;
    if (findBatchConflict(cand, kept)) continue;
    kept.push(cand);
  }
  const pickedRegs = new Set();
  const shipped = [];
  for (const cand of kept) {
    if (shipped.length >= 3) break;
    const r = detectRegister(`${cand.title} ${cand.description}`);
    if (r && pickedRegs.has(r)) continue; // spread preference (test-side greedy)
    shipped.push(cand);
    if (r) pickedRegs.add(r);
  }
  const regs = shipped.map((s) => detectRegister(`${s.title} ${s.description}`));
  const okCount = shipped.length === 3;
  const okDistinct =
    regs.every(Boolean) && new Set(regs).size === regs.length;
  const okSafe = shipped.every(
    (s) => !findSafetyViolation(`${s.title} ${s.description}`),
  );
  const okFeasible = shipped.every(
    (s) =>
      !CAR_REQUIRED.test(`${s.title} ${s.description}`) &&
      !PAID_ACTIVITY.test(`${s.title} ${s.description}`),
  );
  for (const [label, ok] of [
    [`ships 3 quests (got ${shipped.length})`, okCount],
    [`3 distinct registers (${regs.join(", ")})`, okDistinct],
    ["all shipped pass safety", okSafe],
    ["all shipped pass walking-only + free-only feasibility", okFeasible],
  ]) {
    if (ok) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.log(`  ✗ ${label}`);
      failures.push(`Register batch: ${label}`);
      fail++;
    }
  }
}

// ---------- Multi-venue feasibility (soft penalty) ----------
// Duplicated from lib/quest-ranker.ts (same edit-both rule). Fixtures —
// see the NOT-EXEMPLARS banner above.

const MULTI_VENUE =
  /\bat (?:each|every) (?:stop|store|shop|venue|location|cafe|bar|restaurant|business)\b|\b(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:different\s+)?(?:stops|stores|shops|venues|locations|businesses|cafes|bars|restaurants)\b|\b(?:store|shop|cafe|bar|restaurant)\s+to\s+(?:store|shop|cafe|bar|restaurant)\b|\bmulti[- ]stop\b/i;
const JOURNEY_POINT =
  /\b(?:expedition|trek\w*|hik\w+|wander\w*|stroll|walking tour|road trip|loop|trail|summit|viewpoint|journey|pilgrimage|crawl)\b/i;
const requiresMultiVenue = (t) => MULTI_VENUE.test(t) && !JOURNEY_POINT.test(t);

console.log("\n[multi-venue] penalty MUST fire (errand-chain logistics):");
const MULTI_VENUE_FIRE = [
  ["Cheapest Item Cashier Chat Tour", "Order the cheapest item at five different shops, rank the small talk."],
  ["Mall Sample Circuit Sweep", "Collect one free sample at each store before the mall closes."],
  ["Napkin Diplomacy Sweep", "Charm a napkin from three different cafes, crown the smoothest ask."],
];
for (const [title, desc] of MULTI_VENUE_FIRE) {
  if (requiresMultiVenue(`${title} ${desc}`)) {
    console.log(`  ✓ fires  "${title}"`);
    pass++;
  } else {
    console.log(`  ✗ MISSED "${title}"`);
    failures.push(`Multi-venue miss: "${title}"`);
    fail++;
  }
}

console.log("\n[multi-venue] penalty MUST NOT fire (single venue / journey-is-the-point):");
const MULTI_VENUE_SKIP = [
  ["Napkin Tower Table Record", "Build the tallest napkin tower one cafe table allows."],
  ["Ridge Loop Golden Hour Push", "Hike the ridge loop, pausing at three viewpoint stops before sunset."],
  ["Coin Flip Corner Roulette", "Wander with a coin picking every corner until somewhere unfamiliar."],
];
for (const [title, desc] of MULTI_VENUE_SKIP) {
  if (!requiresMultiVenue(`${title} ${desc}`)) {
    console.log(`  ✓ quiet  "${title}"`);
    pass++;
  } else {
    console.log(`  ✗ FALSE  "${title}"`);
    failures.push(`Multi-venue false positive: "${title}"`);
    fail++;
  }
}

// Soft-only guarantee: a multi-venue quest passes the HARD filter (it is
// penalized in scoring, never dropped), and the batch still ships 3.
console.log("\n[multi-venue] soft-only: multi-venue quest survives hard filter, batch still ships 3:");
{
  const poolWithMulti = [
    q("Cheapest Item Cashier Chat Tour", "Order the cheapest item at five different shops, rank the small talk."),
    q("Stairwell Interval Ladder", "Sprint the stairwell in laps, each round adds a floor."),
    q("Parking Meter Estimation Duel", "Estimate odd quantities around you, verify each guess on the spot."),
    q("Pocket Junk Sculpture Show", "Sculpt tiny statues from pocket junk, unveil them gallery-style."),
    q("Golden Hour Cloud Cinema", "Lie back and narrate clouds until the golden hour fades."),
    q("Coin Flip Street Roulette", "Wander with a coin picking every turn until somewhere unfamiliar."),
  ];
  const kept = [];
  for (const cand of poolWithMulti) {
    if (findSafetyViolation(`${cand.title} ${cand.description}`)) continue;
    if (findBatchConflict(cand, kept)) continue;
    kept.push(cand);
  }
  const multiKept = kept.some((k) => k.title === "Cheapest Item Cashier Chat Tour");
  const shipped = kept.slice(0, 3);
  for (const [label, ok] of [
    ["multi-venue quest NOT hard-dropped (soft penalty only)", multiKept],
    [`batch still ships 3 (kept ${kept.length})`, shipped.length === 3],
  ]) {
    if (ok) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.log(`  ✗ ${label}`);
      failures.push(`Multi-venue soft-only: ${label}`);
      fail++;
    }
  }
}

// ---------- Stakes gate (soft penalty) ----------
// Duplicated from lib/quest-ranker.ts (same edit-both rule). Fixtures —
// see the NOT-EXEMPLARS banner above.

const RESOLUTION_MARKERS =
  /\b(?:wins?|winners?|winning|lose|loses|losers?|losing|crown\w*|champion\w*|judge\w*|vot(?:e|es|ed|ing)|first\s+to|last\s+(?:one|person)\s+(?:standing|wins|left)|fastest|reveal\w*|guess\w*|scor(?:e|es|ed|ing)|points?|dar(?:e|es|ed)|tally\w*|rank(?:s|ed|ing)?|bragging|before\s+(?:the\s+)?(?:timer|clock)|time(?:'s|\s+runs?)\s+(?:up|out)|kicked\s+out|showdown|head[- ]to[- ]head)\b/i;
const DOCUMENT_ONLY_END =
  /\b(?:photograph|photo|snap|document|picture)\w*[^.!?]{0,40}\b(?:result|finished|final|structure|sculpture|creation|masterpiece|before\s+leaving)\b/i;
const lacksStakes = (t) => !RESOLUTION_MARKERS.test(t);
const isDocumentOnlyEnd = (t) => DOCUMENT_ONLY_END.test(t);

console.log("\n[stakes] staked quests MUST pass the marker check:");
const STAKED = [
  ["Blind Sauce Championship Night", "Taste five sauces blind, guess each, reveal and crown the champion."],
  ["Furniture Course Speedrun Gauntlet", "Race a furniture obstacle course, fastest time takes bragging rights."],
  ["Absurd Motions Kitchen Court", "Argue ridiculous motions before a friend judge, scoreboard decides it."],
];
for (const [title, desc] of STAKED) {
  if (!lacksStakes(`${title} ${desc}`)) {
    console.log(`  ✓ staked "${title}"`);
    pass++;
  } else {
    console.log(`  ✗ MISSED "${title}"`);
    failures.push(`Stakes miss: "${title}"`);
    fail++;
  }
}

console.log("\n[stakes] busywork MUST trip the no-stakes (and document-only) checks:");
const BUSYWORK = [
  // no resolution marker at all
  ["Creekside Trinket Circle Swap", "Gather riverside sticks and stones, then swap finds until everyone holds another's.", false],
  // no marker AND photograph-the-artifact payoff — the full template
  ["Found Stone Marker Stack", "Gather rocks in an open space, stack a marker, photograph the finished structure.", true],
  ["Litter Sculpture Assembly Hour", "Collect scraps near benches, assemble a shared sculpture, photograph the result.", true],
];
for (const [title, desc, wantDocEnd] of BUSYWORK) {
  const text = `${title} ${desc}`;
  const okCase = lacksStakes(text) && isDocumentOnlyEnd(text) === wantDocEnd;
  if (okCase) {
    console.log(`  ✓ tripped (docEnd=${wantDocEnd}) "${title}"`);
    pass++;
  } else {
    console.log(
      `  ✗ lacksStakes=${lacksStakes(text)} docEnd=${isDocumentOnlyEnd(text)} "${title}"`,
    );
    failures.push(`Stakes busywork case: "${title}"`);
    fail++;
  }
}

// Soft-only guarantee: a stake-free quest still passes the HARD filter —
// the gate demotes in scoring, it never drops.
console.log("\n[stakes] soft-only: stake-free quest survives hard filter, batch still ships 3:");
{
  const poolWithBusywork = [
    q("Found Stone Marker Stack", "Gather rocks in an open space, stack a marker, photograph the finished structure."),
    q("Stairwell Interval Ladder", "Sprint the stairwell in laps, each round adds a floor."),
    q("Parking Meter Estimation Duel", "Estimate odd quantities around you, verify each guess on the spot."),
    q("Golden Hour Cloud Cinema", "Lie back and narrate clouds until the golden hour fades."),
  ];
  const kept = [];
  for (const cand of poolWithBusywork) {
    if (findSafetyViolation(`${cand.title} ${cand.description}`)) continue;
    if (findBatchConflict(cand, kept)) continue;
    kept.push(cand);
  }
  const busyKept = kept.some((k) => k.title === "Found Stone Marker Stack");
  for (const [label, ok] of [
    ["stake-free quest NOT hard-dropped (soft penalty only)", busyKept],
    [`batch still ships 3 (kept ${kept.length})`, kept.length >= 3],
  ]) {
    if (ok) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.log(`  ✗ ${label}`);
      failures.push(`Stakes soft-only: ${label}`);
      fail++;
    }
  }
}

console.log(`\n[summary] ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log("[summary] failure detail:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("[summary] all clean ✓");
