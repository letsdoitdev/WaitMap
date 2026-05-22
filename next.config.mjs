/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure the canonical skill file is bundled into the serverless function
  // for /api/generate. We read it via fs.readFileSync at module load and need
  // Next's file tracing to pick it up.
  experimental: {
    outputFileTracingIncludes: {
      "/api/generate": [".claude/skills/side-quest-generator/SKILL.md"],
    },
  },
};

export default nextConfig;
