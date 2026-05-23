# Unemployed: The Side Quest App

Spontaneous real-world quests for groups of friends. Pick your city, group size, time, and spice — get a handful of creative IRL adventures, start one, and the app tracks it to completion. Sign in to save your quests and keep a history.

Built with Next.js (App Router), React, Tailwind CSS, and Supabase.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Required env vars

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
```

## Deploy

Standard Next.js app, deploys cleanly on Vercel — point Vercel at this repo and ship.

## Database

Run `supabase/migrations/0001_init.sql` in the Supabase SQL editor to provision tables, RLS, indexes, and the lifecycle RPCs. Types live in `lib/database.types.ts`.

## Project layout

- `app/page.tsx` — generator UI (inputs, reroll, results, Start this quest)
- `app/quest/active/page.tsx` — live active-quest detail screen
- `app/quest/[id]/complete/page.tsx` — completion celebration
- `app/quest/[id]/page.tsx` — read-only quest detail
- `app/history/page.tsx` — completed quests list
- `app/auth/callback/route.ts` — OAuth + magic-link redirect handler
- `lib/quests.ts` — quest templates with category/group/time/spice metadata
- `lib/generate.ts` — scoring + weighted random sampling
- `lib/quest-lifecycle.ts` — event-sourced state helpers (`getQuestState`, `computeElapsedMs`)
- `lib/supabase/{client,server,middleware}.ts` — Supabase clients for browser, server components, and the cookie-refresh middleware
- `lib/auth-context.tsx` — auth state + sign-in helpers
- `lib/active-quest-context.tsx` — the user's currently active quest
- `components/{SignInModal,UserMenu,ActiveQuestBanner,BottomNav}.tsx` — auth + lifecycle UI
- `supabase/migrations/0001_init.sql` — schema, RLS, trigger, RPCs
