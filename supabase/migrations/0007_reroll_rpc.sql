-- =============================================================================
-- M12.1 — atomic reroll increment
--
-- Bumps profiles.daily_rerolls[p_date_key] by 1 in a single UPDATE so two
-- concurrent generation requests can't read-modify-write past each other.
-- Returns the post-increment count for the given UTC date key.
--
-- security invoker — runs as the caller, so the profiles_update_own RLS
-- policy (0001) confines each user to their own row.
-- =============================================================================

create or replace function public.increment_daily_reroll(p_date_key text)
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

  update public.profiles
  set daily_rerolls = jsonb_set(
    coalesce(daily_rerolls, '{}'::jsonb),
    array[p_date_key],
    to_jsonb(coalesce((daily_rerolls ->> p_date_key)::int, 0) + 1),
    true
  )
  where id = v_uid
  returning (daily_rerolls ->> p_date_key)::int into v_count;

  return coalesce(v_count, 0);
end;
$$;
