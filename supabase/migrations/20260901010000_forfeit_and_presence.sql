-- Root Cause A fix (see claude/bug-analysis-forfeit-and-matchmaking-plan.md in the
-- project): closing the app mid-match left the remaining player stuck forever,
-- because nothing ever resolved a match once a player stopped participating.
-- This migration adds:
--   1. match_presence — a lightweight per-player heartbeat, so the server can
--      tell "still here" from "gone" without a live WebSocket presence channel.
--   2. matches.end_reason — distinguishes a real AI-judged result from a
--      forfeit or an abandoned match, while reusing the existing 'results'/
--      'cancelled' statuses rather than growing the match_status enum.
--   3. heartbeat() / forfeit_match() RPCs, plus two internal helpers shared
--      by both the explicit-close fast path and the presence sweep below.
--   4. advance_match_phases() extended with a stale-presence sweep, invoked
--      the same opportunistic way it already is (from getMatch(),
--      submit_drawing(), get_my_active_match()) — no cron dependency needed.
--
-- Design notes:
--   - "Gone" is judged purely by absence of a recent heartbeat, not by a
--     specific "I'm backgrounded" event — neither web nor native has a
--     fully reliable "still here" signal, only "here's a recent proof of
--     life, or there isn't." app/match/[id].tsx sends a heartbeat on its
--     existing poll cadence while mounted, visible, and foregrounded, and
--     simply stops when it isn't — that absence is what this sweep reacts
--     to, 10 seconds later.
--   - The sweep intentionally excludes 'judging': once both submissions are
--     in, the match resolves via judge-match (or results screen's existing
--     fallback) regardless of anyone's presence, and forfeiting out from
--     under an in-flight judging call would just create a new race.
--   - A match only becomes sweep-eligible once it's older than the grace
--     window (`created_at < now() - grace`), so a match still in its
--     opening seconds — before either client's first heartbeat can
--     plausibly have landed — is never mistakenly resolved.

-- ---------------------------------------------------------------------------
-- Presence
-- ---------------------------------------------------------------------------

create table public.match_presence (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- RLS enabled with no policies: nothing reads or writes this table directly.
-- All access goes through the security-definer functions below.
alter table public.match_presence enable row level security;

-- ---------------------------------------------------------------------------
-- End reason
-- ---------------------------------------------------------------------------

create type public.match_end_reason as enum ('judged', 'forfeit', 'abandoned');

alter table public.matches add column end_reason public.match_end_reason;

-- ---------------------------------------------------------------------------
-- Internal helpers (not exposed to clients — see the revokes at the bottom).
-- Both are idempotent against a match that's already resolved: the WHERE
-- ... status in (...) guard means a second call (sweep vs. explicit forfeit
-- racing each other, or the sweep visiting the same match twice) is a no-op
-- the second time, so win/loss bookkeeping can never double-apply.
-- ---------------------------------------------------------------------------

create or replace function public._resolve_forfeit(p_match_id uuid, p_loser uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.matches;
  opp uuid;
  updated_rows integer := 0;
begin
  select * into m from public.matches where id = p_match_id for update;
  if m is null or m.is_solo then
    return;
  end if;

  opp := case when m.player_a = p_loser then m.player_b else m.player_a end;
  if opp is null then
    return;
  end if;

  update public.matches
  set status = 'results', winner_id = opp, is_draw = false, end_reason = 'forfeit'
  where id = p_match_id
    and status in ('waiting', 'countdown', 'drawing', 'submitting');
  get diagnostics updated_rows = row_count;

  if updated_rows > 0 then
    update public.profiles set wins = wins + 1 where id = opp;
    update public.profiles set losses = losses + 1 where id = p_loser;
  end if;
end;
$$;

create or replace function public._resolve_abandoned(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.matches
  set status = 'cancelled', end_reason = 'abandoned'
  where id = p_match_id
    and status in ('waiting', 'countdown', 'drawing', 'submitting');
end;
$$;

revoke execute on function public._resolve_forfeit(uuid, uuid) from public;
revoke execute on function public._resolve_abandoned(uuid) from public;

-- ---------------------------------------------------------------------------
-- heartbeat(): called on the client's existing ~2-4s poll cadence while a
-- match screen is mounted, visible, and foregrounded.
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if not public.is_match_player(p_match_id, uid) then
    raise exception 'Not a player in this match';
  end if;

  insert into public.match_presence (match_id, user_id, last_seen_at)
  values (p_match_id, uid, now())
  on conflict (match_id, user_id) do update
    set last_seen_at = excluded.last_seen_at;
end;
$$;

grant execute on function public.heartbeat(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- forfeit_match(): the explicit-close fast path (web `pagehide` -> a
-- fetch(..., {keepalive:true}) call; see app/match/[id].tsx). Resolves the
-- match immediately in the opponent's favor. A solo match just gets
-- cancelled — there's no opponent to award a win to. Losing a race against
-- a real result (match already resolved by the time this lands) is
-- expected, not an error — it's a silent no-op, same as the internal
-- helpers it calls.
-- ---------------------------------------------------------------------------

create or replace function public.forfeit_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches;
  already_submitted boolean;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if m is null then
    raise exception 'Match not found';
  end if;

  if m.player_a <> uid and (m.player_b is null or m.player_b <> uid) then
    raise exception 'Not a player in this match';
  end if;

  if m.status not in ('waiting', 'countdown', 'drawing', 'submitting') then
    return;
  end if;

  if m.is_solo then
    perform public._resolve_abandoned(p_match_id);
    return;
  end if;

  select exists (
    select 1 from public.match_submissions
    where match_id = p_match_id and user_id = uid
  ) into already_submitted;

  -- Already did their part — closing now can't retroactively cost them the
  -- match. The opponent's own submission (or lack of it) still resolves
  -- normally, via judging or the presence sweep on the opponent's side.
  if already_submitted then
    return;
  end if;

  perform public._resolve_forfeit(p_match_id, uid);
end;
$$;

grant execute on function public.forfeit_match(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- advance_match_phases(): existing countdown->drawing and drawing->submitting
-- transitions unchanged, plus a stale-presence sweep so a match a player
-- simply vanished from (crash, force-quit, killed network — anything that
-- never reaches forfeit_match()) still resolves within the same ~10s grace
-- as an explicit background/inactive transition, instead of hanging forever.
-- ---------------------------------------------------------------------------

create or replace function public.advance_match_phases()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  grace constant interval := interval '10 seconds';
  rec record;
  a_gone boolean;
  b_gone boolean;
begin
  -- countdown -> drawing
  update public.matches
  set
    status = 'drawing',
    drawing_ends_at = now() + interval '60 seconds',
    submit_deadline_at = now() + interval '75 seconds'
  where status = 'countdown'
    and countdown_ends_at is not null
    and countdown_ends_at <= now();

  -- drawing -> submitting when timer ends
  update public.matches
  set status = 'submitting'
  where status = 'drawing'
    and drawing_ends_at is not null
    and drawing_ends_at <= now();

  -- Stale-presence sweep. Deliberately excludes 'judging' — see the header
  -- comment above. A player who already submitted their drawing has
  -- fulfilled their half of the match and can never be forfeited for going
  -- quiet afterward (a_submitted/b_submitted below) — only an unsubmitted,
  -- unresponsive player counts as "gone."
  for rec in
    select
      m.id as match_id,
      m.player_a,
      m.player_b,
      m.is_solo,
      pa.last_seen_at as a_seen,
      pb.last_seen_at as b_seen,
      exists (
        select 1 from public.match_submissions s
        where s.match_id = m.id and s.user_id = m.player_a
      ) as a_submitted,
      exists (
        select 1 from public.match_submissions s
        where s.match_id = m.id and m.player_b is not null and s.user_id = m.player_b
      ) as b_submitted
    from public.matches m
    left join public.match_presence pa
      on pa.match_id = m.id and pa.user_id = m.player_a
    left join public.match_presence pb
      on pb.match_id = m.id and m.player_b is not null and pb.user_id = m.player_b
    where m.status in ('countdown', 'drawing', 'submitting')
      and m.created_at < now() - grace
  loop
    a_gone := not rec.a_submitted and (rec.a_seen is null or rec.a_seen < now() - grace);
    b_gone := not rec.is_solo and not rec.b_submitted
      and (rec.b_seen is null or rec.b_seen < now() - grace);

    if rec.is_solo then
      if a_gone then
        perform public._resolve_abandoned(rec.match_id);
      end if;
    else
      if a_gone and b_gone then
        perform public._resolve_abandoned(rec.match_id);
      elsif a_gone then
        perform public._resolve_forfeit(rec.match_id, rec.player_a);
      elsif b_gone then
        perform public._resolve_forfeit(rec.match_id, rec.player_b);
      end if;
    end if;
  end loop;
end;
$$;
