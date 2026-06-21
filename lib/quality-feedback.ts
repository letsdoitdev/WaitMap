import fs from "fs";
import path from "path";

// Owner-curated quality feedback (QUALITY_FEEDBACK.md) -> prompt steering.
//
// The file is parsed ONCE at module load (not per request) and rendered into a
// block that /api/generate appends to its cached system prompt. Empty/missing
// file degrades gracefully to a no-op (today's behavior). This module changes
// no model, no safety logic, and no API contract — it only produces additive
// prompt text.

export type FeedbackEntry = {
  title: string;
  description: string;
  reason: string;
};

export type QualityFeedback = {
  keep: FeedbackEntry[];
  kill: FeedbackEntry[];
};

/** Read QUALITY_FEEDBACK.md from the repo root (with a bundled-output fallback,
 * mirroring how the skill file is loaded). Returns "" if it can't be found. */
function readFeedbackFile(): string {
  const candidates = [
    path.join(process.cwd(), "QUALITY_FEEDBACK.md"),
    path.join(process.cwd(), ".next/server/QUALITY_FEEDBACK.md"),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  return "";
}

/** Extract the body of a `## <name>` section up to the next `## ` or EOF. */
function sectionBody(md: string, name: string): string {
  const re = new RegExp(`##\\s+${name}\\b([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const m = md.match(re);
  return m ? m[1] : "";
}

/** Parse `- Title: / Description: / Reason:` blocks out of a section body. */
function parseEntries(section: string): FeedbackEntry[] {
  const out: FeedbackEntry[] = [];
  // Split on each "- Title:" marker; the first chunk is pre-entry preamble.
  const chunks = section.split(/^\s*-\s*Title:/im).slice(1);
  for (const chunk of chunks) {
    const title = (chunk.split(/\r?\n/)[0] ?? "").trim();
    const descM = chunk.match(/^\s*Description:\s*(.+)$/im);
    const reasonM = chunk.match(/^\s*Reason:\s*(.+)$/im);
    const description = descM ? descM[1].trim() : "";
    const reason = reasonM ? reasonM[1].trim() : "";
    // Title + Description are required for an entry to count.
    if (title && description) out.push({ title, description, reason });
  }
  return out;
}

/** Pure parser (exposed for tests/tooling) — strips HTML comments first so the
 * documented example inside the file's header comment never parses. */
export function parseQualityFeedback(md: string): QualityFeedback {
  const stripped = md.replace(/<!--[\s\S]*?-->/g, "");
  return {
    keep: parseEntries(sectionBody(stripped, "KEEP")),
    kill: parseEntries(sectionBody(stripped, "KILL")),
  };
}

export function loadQualityFeedback(): QualityFeedback {
  return parseQualityFeedback(readFeedbackFile());
}

function renderList(entries: FeedbackEntry[], why: string): string {
  return entries
    .map(
      (e, i) =>
        `${i + 1}. "${e.title}" — ${e.description}${
          e.reason ? ` (why ${why}: ${e.reason})` : ""
        }`,
    )
    .join("\n");
}

/**
 * Render the feedback into a system-prompt block. Returns "" when there are no
 * entries so the prompt is byte-identical to today's. Designed to live INSIDE
 * the cached/ephemeral system block (it's stable across requests).
 */
export function renderQualityFeedbackBlock(): string {
  const { keep, kill } = loadQualityFeedback();
  if (keep.length === 0 && kill.length === 0) return "";

  let s = `

---

# OWNER-CURATED QUALITY FEEDBACK (highest-priority steering)

The owner hand-rated real quests below. Match the spirit, shape, and energy of the GOOD examples; never produce anything resembling the BAD ones. When this conflicts with generic guidance above, this wins (safety rules always still apply).`;

  if (keep.length > 0) {
    s += `\n\n## GOOD — emulate these\n${renderList(keep, "good")}`;
  }
  if (kill.length > 0) {
    s += `\n\n## BAD — never produce quests like these\n${renderList(kill, "bad")}`;
  }
  return s;
}
