# Unemployed: The Side Quest App

Spontaneous real-world quests for groups of friends. Pick your city, group size, time, and spice — get a handful of creative IRL adventures, start one, and the app tracks it to completion. Sign in to save your quests and keep a history.

Built with Next.js (App Router), React, Tailwind CSS, and Supabase.

## Develop

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Env vars

Copy `.env.example` to `.env.local` and fill in:

| Name | Scope | Required | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | **server only** | yes | Anthropic API key powering quest generation. Without it `/api/generate` + `/api/generate/stream` return 503 — there is no local fallback generator. |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | yes | Supabase project URL (auth, storage, database). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | yes | Supabase anon key. |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | client | optional | Mapbox GL JS token. Without it, the history map renders the offline empty state and geocoding no-ops. |
| `MODEL_FIRST_ROLL` / `MODEL_REROLL` | server only | optional | Model routing (`lib/model-routing.ts`): first roll of a session + Pro users vs rerolls. Defaults `claude-sonnet-4-6` / `claude-haiku-4-5`. |
| `MODEL_FORCE_HAIKU` | server only | optional | Kill switch: `1` forces `claude-haiku-4-5` for every generation call. |
| `ADMIN_PASSWORD` | **server only** | yes (for `/admin`) | Password gating the admin training dashboard. Never prefix with `NEXT_PUBLIC_`. Set in the Vercel dashboard for production. |
| `ADMIN_SESSION_SECRET` | **server only** | yes (for `/admin`) | Random secret used to HMAC-sign the `sq_admin` session cookie. Generate with `openssl rand -hex 32`. Set in the Vercel dashboard for production. |

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
- `app/api/generate/route.ts` — AI generation (JSON): SKILL.md-as-system-prompt, overgenerate 6 → rank → ship 3
- `app/api/generate/stream/route.ts` — SSE sibling: first quest streams immediately, rest ranked at stream end
- `lib/quest-ranker.ts` — hard drops (safety/dup/constraints) + mechanical ranking with an exploration slot
- `lib/model-routing.ts` — env-configurable model choice (first roll/Pro vs reroll) + kill switch
- `lib/recent-quests.ts` — persistent `{id, title}` ring buffer feeding the BANNED TITLES blocklist
- `lib/quests.ts` — quest category/type definitions (the old local template generator was removed)
- `lib/generate.ts` — shared generation types (AI-only; no local sampling remains)
- `lib/quest-lifecycle.ts` — event-sourced state helpers (`getQuestState`, `computeElapsedMs`)
- `lib/supabase/{client,server,middleware}.ts` — Supabase clients for browser, server components, and the cookie-refresh middleware
- `lib/auth-context.tsx` — auth state + sign-in helpers
- `lib/active-quest-context.tsx` — the user's currently active quest
- `components/{SignInModal,UserMenu,ActiveQuestBanner,BottomNav}.tsx` — auth + lifecycle UI
- `supabase/migrations/0001_init.sql` — schema, RLS, trigger, RPCs
