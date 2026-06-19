This repo uses the side-quest-generator skill at .claude/skills/side-quest-generator/SKILL.md. Load it when working on quest generation logic.

## Required env vars

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — auth + storage + database (set since M5).
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox GL JS access token. Required for the `/map` page and lazy geocoding (M7). If unset, `/map` renders the "Map is offline" empty state and geocoding silently no-ops — nothing crashes, but no pins will appear.

## M12.2 — Free/Pro gating finish + admin demo tier toggle

- Client now enforces the M12.1 reroll cap: a `402 { error: 'reroll_limit' }` from `/api/generate` opens `<OutOfRerollsModal />` instead of falling back to the local generator. The local fallback survives only for network throws and 5xx.
- `<OutOfRerollsModal />` (`components/OutOfRerollsModal.tsx`) is the upsell: "Go Pro" fires a "Coming soon" toast — no pricing page, no Stripe, no IAP.
- Admin demo tier toggle: `<DemoTierToggle />` in `UserMenu` (above Sign out) flips the current user's tier via `POST /api/admin/tier`. The route re-checks `ADMIN_EMAILS` (in `lib/constants.ts`) server-side on every request (not gated on `NODE_ENV`); going Pro sets `tier_expires_at = now + 365d`, going Free clears it. Non-admins get 403.

## Quest generation quality (prompt = SKILL + few-shot + overrides)

- The prompt for `/api/generate` is assembled in `lib/quest-prompt.ts`: `SKILL.md` body + website overrides + the few-shot gold + negative examples, all baked into one **cached** system block (`SYSTEM_PROMPT`, marked `cache_control: ephemeral`). The route's user message carries only per-request content (histogram, diversity seed, tier pointer, banned titles) so the cache prefix stays stable. `node eval/check-cache.mjs` guards this invariant.
- Few-shot gold + negative examples live in `lib/quest-examples.json` (single source of truth, imported by `lib/quest-prompt.ts` and scored by the eval). Gold is 4 tiers (matching the skill's spice tiers), each with 3 distinct-category exemplars using **generic anchors only** — never brand/venue proper nouns. Negative examples are tagged with the exact failure mode they model (synchronized-performance trap, food-in-body stakes, code-name/rule-overlay sport, venue-name leak).
- Eval harness in `eval/`: `npm run eval` scores the few-shot exemplars before/after (deterministic, no API key); `npm run eval:live` scores live `/api/generate` output across 15 scenarios; `npm run eval:mine` mines `data/ratings.json` (currently empty) for 🔥 styles to bias the gold set. Rubric (`eval/rubric.mjs`) is an independent scorer for food-cap, diversity, venue-leak, and doability.
