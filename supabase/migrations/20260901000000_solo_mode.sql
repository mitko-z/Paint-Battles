-- Single-player mode: a solo match has no opponent (player_b is null) and
-- only needs its lone player's drawing before judging can run. Reuses the
-- exact same countdown -> drawing -> submitting -> judging -> results
-- state machine as 1v1 matches (see 20260311000000_initial.sql) instead of
-- introducing a parallel code path.

alter table public.matches alter column player_b drop not null;
alter table public.matches add column is_solo boolean not null default false;

-- ---------------------------------------------------------------------------
-- start_solo_match(): mirrors create_room()/join_room()'s setup (clears any
-- stale queue/room state, checks for an existing active match) but creates
-- the match directly instead of waiting for a second player.
-- ---------------------------------------------------------------------------

create or replace function public.start_solo_match()
returns public.matches
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  new_match public.matches;
  chosen_prompt text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.active_match_for(uid) is not null then
    raise exception 'Already in an active match';
  end if;

  delete from public.matchmaking_queue where user_id = uid;
  update public.rooms
    set status = 'closed'
    where host_id = uid and status = 'waiting';

  chosen_prompt := public.random_prompt();

  insert into public.matches (
    player_a, player_b, is_solo, prompt, status, countdown_ends_at
  ) values (
    uid,
    null,
    true,
    chosen_prompt,
    'countdown',
    now() + interval '3 seconds'
  )
  returning * into new_match;

  return new_match;
end;
$$;

grant execute on function public.start_solo_match() to authenticated;

-- ---------------------------------------------------------------------------
-- submit_drawing(): a solo match only ever has one submission to wait for,
-- so it needs its own threshold instead of the hardcoded "both players" (2).
--
-- Also fixes a latent null-safety bug in the ownership check: with
-- player_b nullable, `m.player_a <> uid and m.player_b <> uid` evaluates
-- to NULL (treated as false by plpgsql's `if`) for any *other* user
-- calling on a solo match, silently skipping the "Not a player" exception.
-- Same return type/signature as the 20260827090000 migration, so a plain
-- create-or-replace is enough here (no drop needed).
-- ---------------------------------------------------------------------------

create or replace function public.submit_drawing(p_match_id uuid, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  submission public.match_submissions;
  submission_count integer;
  required_submissions integer;
  updated_rows integer := 0;
  should_request_judging boolean := false;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  perform public.advance_match_phases();

  select * into m from public.matches where id = p_match_id for update;
  if m is null then
    raise exception 'Match not found';
  end if;

  if m.player_a <> uid and (m.player_b is null or m.player_b <> uid) then
    raise exception 'Not a player in this match';
  end if;

  if m.status not in ('drawing', 'submitting') then
    raise exception 'Match is not accepting submissions';
  end if;

  if m.submit_deadline_at is not null and now() > m.submit_deadline_at then
    raise exception 'Submission deadline passed';
  end if;

  -- Early submit keeps status as drawing so the opponent (1v1 only) can
  -- keep drawing until they submit or the shared timer ends
  -- (advance_match_phases).

  insert into public.match_submissions (match_id, user_id, storage_path)
  values (p_match_id, uid, p_storage_path)
  on conflict (match_id, user_id) do update
    set storage_path = excluded.storage_path,
        submitted_at = now()
  returning * into submission;

  select count(*) into submission_count
  from public.match_submissions
  where match_id = p_match_id;

  required_submissions := case when m.is_solo then 1 else 2 end;

  -- All required submissions in (early or after timeout) → judging.
  -- Whichever call's UPDATE actually matches a row (status still
  -- 'drawing'/'submitting') is, by construction, the one and only call
  -- that flips it — see 20260827090000_submit_drawing_judging_claim.sql.
  if submission_count >= required_submissions then
    update public.matches
    set status = 'judging'
    where id = p_match_id
      and status in ('drawing', 'submitting');
    get diagnostics updated_rows = row_count;
    should_request_judging := updated_rows > 0;
  end if;

  return jsonb_build_object(
    'submission', to_jsonb(submission),
    'shouldRequestJudging', should_request_judging
  );
end;
$$;

grant execute on function public.submit_drawing(uuid, text) to authenticated;
