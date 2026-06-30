/** @type {import('next').NextConfig} */
const nextConfig = {
  // Bundle the canonical constitution (SKILL.md) into the serverless functions
  // for both generate routes — it's read via fs.readFileSync at module load and
  // needs Next's file tracing to pick it up.
  experimental: {
    outputFileTracingIncludes: {
      "/api/generate": [".claude/skills/side-quest-generator/SKILL.md"],
      "/api/generate/stream": [
        ".claude/skills/side-quest-generator/SKILL.md",
      ],
    },
  },
};

export default nextConfig;
