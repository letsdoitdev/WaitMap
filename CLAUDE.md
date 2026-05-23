This repo uses the side-quest-generator skill at .claude/skills/side-quest-generator/SKILL.md. Load it when working on quest generation logic.

## Required env vars

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — auth + storage + database (set since M5).
- `NEXT_PUBLIC_MAPBOX_TOKEN` — Mapbox GL JS access token. Required for the `/map` page and lazy geocoding (M7). If unset, `/map` renders the "Map is offline" empty state and geocoding silently no-ops — nothing crashes, but no pins will appear.
