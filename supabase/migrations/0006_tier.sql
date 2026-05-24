-- =============================================================================
-- M12.1 — Free/Pro tier data layer
--
-- Adds tier state to profiles. NO payments, NO Stripe, NO IAP — this is the
-- data layer + gating substrate only. Pro is provisioned out-of-band for now.
--
-- Run in the Supabase SQL editor after merging. Idempotent — the column adds
-- use `if not exists` and the DEFAULT backfills existing rows automatically.
--
-- Numbering: 0005 is the last existing migration; this is 0006.
-- =============================================================================

alter table public.profiles
  add column if not exists tier text not null default 'free'
    check (tier in ('free', 'pro')),
  add column if not exists tier_expires_at timestamptz,
  add column if not exists daily_rerolls jsonb not null default '{}'::jsonb;
