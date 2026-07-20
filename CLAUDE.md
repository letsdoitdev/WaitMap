This repo uses the side-quest-generator skill at .claude/skills/side-quest-generator/SKILL.md. Load it when working on quest generation logic. The SKILL.md body IS the runtime system prompt (loaded verbatim by `/api/generate`), so edits to it change production generation behavior.

## Required env vars

- `ANTHROPIC_API_KEY` — **required for quest generation.** `/api/generate` and `/api/generate/stream` return 503 without it; there is NO local fallback generator (the template-based one was deleted in the AI-only migration — a failed API call surfaces an error toast, nothing else).
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — auth + storage + database (set since M5).
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox GL JS access token. Required for the history map and lazy geocoding (M7). If unset, the map renders the "Map is offline" empty state and geocoding silently no-ops — nothing crashes, but no pins will appear.
- `MODEL_FIRST_ROLL` / `MODEL_REROLL` / `MODEL_FORCE_HAIKU` — optional model routing (M13, see `lib/model-routing.ts`). Defaults: first roll of a session + Pro users → `claude-sonnet-4-6`, rerolls → `claude-haiku-4-5`. `MODEL_FORCE_HAIKU=1` is the kill switch (forces Haiku everywhere).

## M13 — Quest generation pipeline (how a roll actually works)

1. Client (`app/page.tsx`) builds one request body via `buildGenerateBody()` for both endpoints: region, venue `typeCounts`, spice/group/time, `canDrive`, 3-value `costPref`, onboarding `vibeCategories`, local hour/weekday, and a `previousTitles` blocklist fed by the `{id, title}` ring buffer (`lib/recent-quests.ts`, 30 entries). Nearby venue context is prefetched on city change; the FIRST roll of a session additionally waits up to 2s for it.
2. `/api/generate/stream` (SSE, primary) and `/api/generate` (JSON, mobile contract + web fallback) share prompt construction: the cached system prompt is SKILL.md + a static `REQUEST_PROTOCOL` (route.ts) — together past Haiku 4.5's 4096-token minimum cacheable prefix, 1h TTL — and `buildUserMessage()` emits only volatile lines. All client-controlled strings are sanitized/capped before prompt interpolation.
3. One model call requests **6 candidates** (model chosen by `lib/model-routing.ts`); `stop_reason` is checked with one corrective re-ask on truncation/parse failure. Candidates are venue-scrubbed, then hard-filtered (`lib/quest-ranker.ts`): safety regexes, near-dup vs blocklist/siblings (0.45 bigram Jaccard or shared trigram), car-required under walking-only, paid under free-only. One shortfall re-ask if fewer than 3 survive. `selectTopQuests` ships the best 3 — mechanical score (SKILL.md word ceilings, vibe match, food balance) + category-spread bonus, at most 1 food quest, and the final slot is the EXPLORATION pick outside the user's vibes.
4. The stream path emits the first hard-check-passing quest immediately (time-to-first-card), ranks the rest at end of stream, and tops up via the shared `buildUserMessage` (full constraints + emitted titles in the blocklist) when short.
5. Reroll metering: free users get `FREE_DAILY_REROLLS`/day (UTC), checked before generation, charged via `increment_daily_reroll` after success; 402 `{ error: 'reroll_limit' }` → `<OutOfRerollsModal />`.

Offline verification: `node app/api/generate/_verify.mjs` (safety regexes + Jaccard, duplicated by design). Post-deploy checks that need a live key: `[generate] cache` logs must show `cacheRead > 0` on warm calls **per model**, and stream first-card p50 should not regress >1s vs pre-M13.

## M12.2 — Free/Pro gating finish + admin demo tier toggle

- Client enforces the M12.1 reroll cap: a `402 { error: 'reroll_limit' }` from either generate endpoint opens `<OutOfRerollsModal />`. There is no local generator anywhere — network throws and 5xx surface a retry toast.
- `<OutOfRerollsModal />` (`components/OutOfRerollsModal.tsx`) is the upsell: "Go Pro" fires a "Coming soon" toast — no pricing page, no Stripe, no IAP.
- Admin demo tier toggle: `<DemoTierToggle />` in `UserMenu` (above Sign out) flips the current user's tier via `POST /api/admin/tier`. The route re-checks `ADMIN_EMAILS` (in `lib/constants.ts`) server-side on every request (not gated on `NODE_ENV`); going Pro sets `tier_expires_at = now + 365d`, going Free clears it. Non-admins get 403.
