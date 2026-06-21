/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle the files read via fs.readFileSync at module load into the
  // serverless functions for the generate routes. Both the canonical skill and
  // the owner quality-feedback doc are needed; the stream route imports the
  // same module as /api/generate, so it needs them traced too.
  experimental: {
    outputFileTracingIncludes: {
      "/api/generate": [
        ".claude/skills/side-quest-generator/SKILL.md",
        "QUALITY_FEEDBACK.md",
      ],
      "/api/generate/stream": [
        ".claude/skills/side-quest-generator/SKILL.md",
        "QUALITY_FEEDBACK.md",
      ],
    },
  },
};

export default nextConfig;
