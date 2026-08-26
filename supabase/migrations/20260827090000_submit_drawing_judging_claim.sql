-- Closes the "two players' browsers both call requestJudgment at the same
-- instant" race (2026-08-27, Incident 4's open question) WITHOUT a lock
-- table or a new column. submit_drawing() already takes a row lock on the
-- match ("select ... for update", below) before deciding whether both
-- submissions are now present — that lock already serializes any two
-- concurrent submit_drawing() calls for the same match_id, so it's the
-- natural place to atomically decide who is responsible for calling
-- judge-match, instead of leaving both clients to separately notice
-- status = 'judging' and race each other to request it.
--
-- Return type changes from match_submissions to jsonb (submission +
-- shouldRequestJudging), so this needs drop + create rather than
-- create-or-replace (Postgres won't let a replace change return type).

drop function if exists public.submit_drawing(uuid, text);

create function public.submit_drawing(p_match_id uuid, p_storage_path text)
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

  if m.player_a <> uid and m.player_b <> uid then
    raise exception 'Not a player in this match';
  end if;

  if m.status not in ('drawing', 'submitting') then
    raise exception 'Match is not accepting submissions';
  end if;

  if m.submit_deadline_at is not null and now() > m.submit_deadline_at then
    raise exception 'Submission deadline passed';
  end if;

  -- Early submit keeps status as drawing so the opponent can keep drawing
  -- until they submit or the shared timer ends (advance_match_phases).

  insert into public.match_submissions (match_id, user_id, storage_path)
  values (p_match_id, uid, p_storage_path)
  on conflict (match_id, user_id) do update
    set storage_path = excluded.storage_path,
        submitted_at = now()
  returning * into submission;

  select count(*) into submission_count
  from public.match_submissions
  where match_id = p_match_id;

  -- Both finished (early or after timeout) → judging. Whichever call's
  -- UPDATE actually matches a row (status still 'drawing'/'submitting')
  -- is, by construction, the one and only call that flips it — a
  -- resubmission or a losing concurrent call finds status already
  -- 'judging' and matches zero rows, so should_request_judging correctly
  -- stays false for it. That's the whole claim: no separate lock needed.
  if submission_count >= 2 then
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
