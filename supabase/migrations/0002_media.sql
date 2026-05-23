-- =============================================================================
-- Milestone 6 — completion media (photos + short video)
--
-- Run this in the Supabase SQL editor after merging. The `quest-media`
-- bucket is created if missing; storage policies + table policies are
-- idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- quest_media table
-- -----------------------------------------------------------------------------
create table if not exists public.quest_media (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references public.quests(id) on delete cascade,
  quest_event_id uuid not null references public.quest_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  bytes bigint not null,
  width int,
  height int,
  duration_ms int,
  created_at timestamptz not null default now()
);

alter table public.quest_media enable row level security;

drop policy if exists "quest_media_select_own" on public.quest_media;
drop policy if exists "quest_media_insert_own" on public.quest_media;
drop policy if exists "quest_media_update_own" on public.quest_media;
drop policy if exists "quest_media_delete_own" on public.quest_media;

create policy "quest_media_select_own"
  on public.quest_media for select using (auth.uid() = user_id);
create policy "quest_media_insert_own"
  on public.quest_media for insert with check (auth.uid() = user_id);
create policy "quest_media_update_own"
  on public.quest_media for update using (auth.uid() = user_id);
create policy "quest_media_delete_own"
  on public.quest_media for delete using (auth.uid() = user_id);

create index if not exists quest_media_quest_idx
  on public.quest_media(quest_id, created_at desc);
create index if not exists quest_media_user_created_idx
  on public.quest_media(user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Storage bucket — private. Each user can only touch objects whose first
-- path segment is their own auth.uid().
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quest-media',
  'quest-media',
  false,
  26214400, -- 25 MB
  array[
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp',
    'video/mp4',
    'video/quicktime'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies — owner can read/insert/update/delete their own objects.
drop policy if exists "quest_media_storage_select_own" on storage.objects;
drop policy if exists "quest_media_storage_insert_own" on storage.objects;
drop policy if exists "quest_media_storage_update_own" on storage.objects;
drop policy if exists "quest_media_storage_delete_own" on storage.objects;

create policy "quest_media_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'quest-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "quest_media_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'quest-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "quest_media_storage_update_own"
  on storage.objects for update
  using (
    bucket_id = 'quest-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "quest_media_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'quest-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
