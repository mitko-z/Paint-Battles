-- join_queue() had a race condition: it checks "is anyone else waiting?"
-- and only inserts the caller's own row afterward. If two players call
-- join_queue() at nearly the same moment, both transactions can run that
-- check before either has inserted its row, so both see an empty queue,
-- both insert themselves, and neither ever notices the other. Nothing
-- afterward re-triggers pairing between two players who are already
-- sitting in the queue — matching only happens as a side effect of a
-- *new* caller's join_queue() call. Two simultaneous waiters with no
-- third player joining were left stranded in the queue forever, with the
-- client polling for a match that would never be created.
--
-- Fix: serialize join_queue() calls with a transaction-scoped advisory
-- lock so concurrent callers can no longer race past each other. The
-- lock is released automatically when the transaction commits.

create or replace function public.join_queue()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  opponent uuid;
  new_match public.matches;
  chosen_prompt text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if public.active_match_for(uid) is not null then
    raise exception 'Already in an active match';
  end if;

  -- Serialize all join_queue() calls against each other so the
  -- "check for a waiter, then insert myself" sequence below can't race.
  perform pg_advisory_xact_lock(hashtext('matchmaking_queue'));

  -- Pair with oldest waiter who is not self
  select q.user_id into opponent
  from public.matchmaking_queue q
  where q.user_id <> uid
    and q.joined_at > now() - interval '5 minutes'
  order by q.joined_at asc
  limit 1
  for update skip locked;

  if opponent is not null then
    delete from public.matchmaking_queue where user_id in (uid, opponent);
    chosen_prompt := public.random_prompt();

    insert into public.matches (
      player_a, player_b, prompt, status, countdown_ends_at
    ) values (
      opponent,
      uid,
      chosen_prompt,
      'countdown',
      now() + interval '3 seconds'
    )
    returning * into new_match;

    return jsonb_build_object('matched', true, 'match', to_jsonb(new_match));
  end if;

  insert into public.matchmaking_queue (user_id, joined_at)
  values (uid, now())
  on conflict (user_id) do update set joined_at = excluded.joined_at;

  return jsonb_build_object('matched', false, 'queued', true);
end;
$$;

grant execute on function public.join_queue() to authenticated;
