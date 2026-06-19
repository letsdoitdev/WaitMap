#!/usr/bin/env node
// Static guard: verify the STABLE few-shot content sits inside the prompt-cache
// breakpoint so the quality changes don't break Anthropic prompt caching.
//
// Anthropic caches an exact PREFIX. We mark the system block with
// cache_control: ephemeral, so everything stable must live in SYSTEM_PROMPT
// (lib/quest-prompt.ts) and anything that varies per request must stay in the
// user message. This script asserts that invariant by reading the source, so a
// future refactor that accidentally moves the exemplars back into the
// per-request user message fails CI loudly.
//
//   node eval/check-cache.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const route = fs.readFileSync(
  path.join(ROOT, "app/api/generate/route.ts"),
  "utf8",
);
const prompt = fs.readFileSync(path.join(ROOT, "lib/quest-prompt.ts"), "utf8");

const checks = [];
function check(name, ok, hint) {
  checks.push({ name, ok, hint });
}

// 1. The system block is marked for caching with SYSTEM_PROMPT as its text.
const cachedSystem =
  /text:\s*SYSTEM_PROMPT,\s*cache_control:\s*\{\s*type:\s*"ephemeral"\s*\}/s.test(
    route,
  );
check("system block is cache_control: ephemeral with SYSTEM_PROMPT", cachedSystem);

// 2. SYSTEM_PROMPT bakes in the stable example block (gold + negatives).
const baked =
  /SYSTEM_PROMPT\s*=\s*`[\s\S]*\$\{EXAMPLES_SECTION\}/.test(prompt) ||
  prompt.includes("${EXAMPLES_SECTION}");
check("SYSTEM_PROMPT includes the gold + negative EXAMPLES_SECTION", baked);

// 3. The per-request user message must NOT inline the full few-shot/negatives.
//    It may only carry the lightweight tier pointer.
const userInlinesExamples =
  /baseUserMessage[\s\S]*\$\{(?:fewShotStr|NEGATIVE_EXAMPLES|renderFewShot)/.test(
    route,
  );
check("user message does NOT inline few-shot / negative blocks", !userInlinesExamples);

// 4. The tier pointer is what the user message carries instead.
const usesPointer = /\$\{tierPointer\}/.test(route);
check("user message carries the lightweight tierPointer", usesPointer);

// 5. Per-request varying content (histogram, diversity seed, banned titles)
//    stays in the user message, not the cached system prompt.
const dynamicInUser =
  /\$\{histogram\}/.test(route) && /\$\{diversityStr\}/.test(route);
check("per-request histogram + diversity seed remain in the user message", dynamicInUser);

let allOk = true;
console.log("\n=== PROMPT-CACHE BREAKPOINT CHECK ===\n");
for (const c of checks) {
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.ok) allOk = false;
}
console.log(
  allOk
    ? "\nAll cache invariants hold: stable few-shot is inside the cached prefix.\n"
    : "\nCACHE INVARIANT VIOLATED — see failures above.\n",
);
process.exit(allOk ? 0 : 1);
