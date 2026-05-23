-- =============================================================================
-- Milestone 7.5 — precise completion coordinates
--
-- Run this in the Supabase SQL editor after merging. Idempotent — safe to
-- re-run.
-- =============================================================================

alter table public.quests
  add column if not exists completion_lat double precision;

alter table public.quests
  add column if not exists completion_lng double precision;

alter table public.quests
  add column if not exists completion_accuracy_m double precision;

alter table public.quests
  add column if not exists completion_captured_at timestamptz;
