-- Early submit must not force the match into submitting/judging.
-- One player finishing early only records their drawing; the opponent
-- keeps drawing until they submit or drawing_ends_at elapses.
-- Judging starts only when both submissions exist.

create or replace function public.submit_drawing(p_match_id uuid, p_storage_path text)
returns public.match_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  submission public.match_submissions;
  submission_count integer;
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

  insert into public.match_submissions (match_id, user_id, storage_path)
  values (p_match_id, uid, p_storage_path)
  on conflict (match_id, user_id) do update
    set storage_path = excluded.storage_path,
        submitted_at = now()
  returning * into submission;

  select count(*) into submission_count
  from public.match_submissions
  where match_id = p_match_id;

  if submission_count >= 2 then
    update public.matches
    set status = 'judging'
    where id = p_match_id
      and status in ('drawing', 'submitting');
  end if;

  return submission;
end;
$$;
