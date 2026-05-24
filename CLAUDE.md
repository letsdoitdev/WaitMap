This repo uses the side-quest-generator skill at .claude/skills/side-quest-generator/SKILL.md. Load it when working on quest generation logic.

## Required env vars

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — auth + storage + database (set since M5).
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox GL JS access token. Required for the `/map` page and lazy geocoding (M7). If unset, `/map` renders the "Map is offline" empty state and geocoding silently no-ops — nothing crashes, but no pins will appear.

## M12.2 — Free/Pro gating finish + admin demo tier toggle

- Client now enforces the M12.1 reroll cap: a `402 { error: 'reroll_limit' }` from `/api/generate` opens `<OutOfRerollsModal />` instead of falling back to the local generator. The local fallback survives only for network throws and 5xx.
- `<OutOfRerollsModal />` (`components/OutOfRerollsModal.tsx`) is the upsell: "Go Pro" fires a "Coming soon" toast — no pricing page, no Stripe, no IAP.
- Admin demo tier toggle: `<DemoTierToggle />` in `UserMenu` (above Sign out) flips the current user's tier via `POST /api/admin/tier`. The route re-checks `ADMIN_EMAILS` (in `lib/constants.ts`) server-side on every request (not gated on `NODE_ENV`); going Pro sets `tier_expires_at = now + 365d`, going Free clears it. Non-admins get 403.
