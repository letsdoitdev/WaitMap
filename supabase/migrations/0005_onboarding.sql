-- =============================================================================
-- M8.1 — onboarding state
--
-- One row per authenticated user. Anonymous users persist into localStorage
-- (key: "unemployment.onboarding.v1") and the row gets mirrored on sign-in.
--
-- Run this in the Supabase SQL editor after merging. Idempotent — re-run
-- safe (uses `if not exists`, `or replace`, and `drop policy if exists`).
--
-- Note on numbering: the spec called for 0002_onboarding.sql but 0002 is
-- already in use by the M6 media migration. Bumped to 0005 so existing
-- migrations stay intact.
-- =============================================================================

create table if not exists public.user_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  group_modes text[] not null default '{}'::text[],
  vibe_categories text[] not null default '{}'::text[],
  spice int,
  time_minutes int,
  can_drive boolean,
  cost_pref text check (cost_pref in ('free', 'cheap', 'any')),
  onboarding_completed_at timestamptz,
  review_prompted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding enable row level security;

drop policy if exists "user_onboarding_select_own" on public.user_onboarding;
drop policy if exists "user_onboarding_insert_own" on public.user_onboarding;
drop policy if exists "user_onboarding_update_own" on public.user_onboarding;
drop policy if exists "user_onboarding_delete_own" on public.user_onboarding;

create policy "user_onboarding_select_own"
  on public.user_onboarding for select using (auth.uid() = user_id);
create policy "user_onboarding_insert_own"
  on public.user_onboarding for insert with check (auth.uid() = user_id);
create policy "user_onboarding_update_own"
  on public.user_onboarding for update using (auth.uid() = user_id);
create policy "user_onboarding_delete_own"
  on public.user_onboarding for delete using (auth.uid() = user_id);

-- Bump updated_at on every UPDATE.
create or replace function public.user_onboarding_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_onboarding_set_updated_at on public.user_onboarding;
create trigger user_onboarding_set_updated_at
  before update on public.user_onboarding
  for each row execute function public.user_onboarding_touch_updated_at();
