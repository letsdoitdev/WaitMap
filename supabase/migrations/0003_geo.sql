-- =============================================================================
-- Milestone 7 — geocoded coordinates on quests
--
-- Run this in the Supabase SQL editor after merging. Idempotent — safe to
-- re-run on a database that already has 0001_init.sql + 0002_media.sql.
-- =============================================================================

alter table public.quests
  add column if not exists lat double precision;

alter table public.quests
  add column if not exists lng double precision;

create index if not exists quests_user_geo_idx
  on public.quests(user_id)
  where lat is not null;
