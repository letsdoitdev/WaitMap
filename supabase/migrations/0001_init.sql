-- =============================================================================
-- Milestone 5 — accounts + quest lifecycle
--
-- Run this in the Supabase SQL editor after merging. Idempotent-ish: uses
-- `if not exists` where it can; otherwise drop and re-run the failing block.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert_own"
  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = id);
create policy "profiles_delete_own"
  on public.profiles for delete using (auth.uid() = id);

-- -----------------------------------------------------------------------------
-- quests
-- -----------------------------------------------------------------------------
create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null,
  spice int not null,
  estimated_minutes int,
  location_text text,
  source text not null default 'ai_generated'
    check (source in ('ai_generated', 'user_suggested')),
  reaction text
    check (reaction in ('cooked', 'mid', 'tuff', 'fire')),
  generated_at timestamptz not null default now()
);

alter table public.quests enable row level security;

drop policy if exists "quests_select_own" on public.quests;
drop policy if exists "quests_insert_own" on public.quests;
drop policy if exists "quests_update_own" on public.quests;
drop policy if exists "quests_delete_own" on public.quests;

create policy "quests_select_own"
  on public.quests for select using (auth.uid() = user_id);
create policy "quests_insert_own"
  on public.quests for insert with check (auth.uid() = user_id);
create policy "quests_update_own"
  on public.quests for update using (auth.uid() = user_id);
create policy "quests_delete_own"
  on public.quests for delete using (auth.uid() = user_id);

create index if not exists quests_user_generated_idx
  on public.quests(user_id, generated_at desc);

-- -----------------------------------------------------------------------------
-- quest_events
-- -----------------------------------------------------------------------------
create table if not exists public.quest_events (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null
    check (event_type in ('started', 'paused', 'resumed', 'completed', 'abandoned')),
  created_at timestamptz not null default now()
);

alter table public.quest_events enable row level security;

drop policy if exists "quest_events_select_own" on public.quest_events;
drop policy if exists "quest_events_insert_own" on public.quest_events;
drop policy if exists "quest_events_update_own" on public.quest_events;
drop policy if exists "quest_events_delete_own" on public.quest_events;

create policy "quest_events_select_own"
  on public.quest_events for select using (auth.uid() = user_id);
create policy "quest_events_insert_own"
  on public.quest_events for insert with check (auth.uid() = user_id);
create policy "quest_events_update_own"
  on public.quest_events for update using (auth.uid() = user_id);
create policy "quest_events_delete_own"
  on public.quest_events for delete using (auth.uid() = user_id);

create index if not exists quest_events_user_created_idx
  on public.quest_events(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- daily_generation_counter (silent in M5; M8 will enforce a limit)
-- -----------------------------------------------------------------------------
create table if not exists public.daily_generation_counter (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  count int not null default 0,
  primary key (user_id, date)
);

alter table public.daily_generation_counter enable row level security;

drop policy if exists "daily_gen_select_own" on public.daily_generation_counter;
drop policy if exists "daily_gen_insert_own" on public.daily_generation_counter;
drop policy if exists "daily_gen_update_own" on public.daily_generation_counter;
drop policy if exists "daily_gen_delete_own" on public.daily_generation_counter;

create policy "daily_gen_select_own"
  on public.daily_generation_counter for select using (auth.uid() = user_id);
create policy "daily_gen_insert_own"
  on public.daily_generation_counter for insert with check (auth.uid() = user_id);
create policy "daily_gen_update_own"
  on public.daily_generation_counter for update using (auth.uid() = user_id);
create policy "daily_gen_delete_own"
  on public.daily_generation_counter for delete using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Trigger: auto-provision a profile when a new auth.users row appears.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RPC: start_quest
--
-- Inserts a quest row and the initial 'started' event in a single
-- transaction, while enforcing the one-active-quest-per-user invariant.
-- Raises 'active_quest_exists' if the user already has an active or paused
-- quest. SECURITY INVOKER so RLS still applies.
-- -----------------------------------------------------------------------------
create or replace function public.start_quest(
  p_title text,
  p_description text,
  p_category text,
  p_spice int,
  p_estimated_minutes int,
  p_location_text text,
  p_source text default 'ai_generated'
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_quest_id uuid;
  v_active_count int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- Active = the latest event on the quest is started / paused / resumed
  -- (i.e. the user has not yet completed or abandoned it).
  select count(*) into v_active_count
  from public.quests q
  where q.user_id = v_uid
    and (
      select e.event_type
      from public.quest_events e
      where e.quest_id = q.id
      order by e.created_at desc
      limit 1
    ) in ('started', 'paused', 'resumed');

  if v_active_count > 0 then
    raise exception 'active_quest_exists' using errcode = 'P0002';
  end if;

  insert into public.quests (
    user_id, title, description, category, spice,
    estimated_minutes, location_text, source
  ) values (
    v_uid, p_title, p_description, p_category, p_spice,
    p_estimated_minutes, p_location_text, p_source
  )
  returning id into v_quest_id;

  insert into public.quest_events (quest_id, user_id, event_type)
  values (v_quest_id, v_uid, 'started');

  return v_quest_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: increment_daily_generation_counter
-- -----------------------------------------------------------------------------
create or replace function public.increment_daily_generation_counter()
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count int;
begin
  if v_uid is null then
    return 0;
  end if;

  insert into public.daily_generation_counter (user_id, date, count)
  values (v_uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, date) do update
    set count = public.daily_generation_counter.count + 1
  returning count into v_count;

  return v_count;
end;
$$;
