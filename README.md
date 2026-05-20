# Side Quest Generator

A spontaneous IRL adventure generator for groups of friends. Enter your city, group size, time, and spice level — get 3-5 creative real-world quests drawn from a database of 50+ challenges across Chaos, Outdoor, Social, Creative, Food, and Late Night categories.

Built with Next.js, React, and Tailwind CSS.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

This is a standard Next.js app and deploys cleanly on Vercel — point Vercel at this repo and ship.

## Project layout

- `app/page.tsx` — generator UI (inputs, reroll, results)
- `lib/quests.ts` — 50+ quest templates with category/group/time/spice metadata
- `lib/generate.ts` — scoring + weighted random sampling
