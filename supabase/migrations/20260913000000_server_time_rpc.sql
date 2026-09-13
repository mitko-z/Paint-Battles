-- Clock-offset hardening (2026-09-13).
--
-- Root cause of the linked "timer starts/ends a few seconds off" +
-- "whistle doesn't play" + "Could not capture drawing" bugs: the client's
-- countdown (useServerCountdown) compares an absolute server timestamp
-- (matches.drawing_ends_at) against the *client's own* Date.now(), with no
-- correction for client/server clock skew. Real devices (observed at 100%
-- on Android vs the hosted web build, ~10% on localhost) can have a clock
-- that's off from the server by a couple of seconds, which is enough to:
--   1. shift the displayed countdown start/end by that same offset,
--   2. delay the client's *local* "drawing phase is over" signal past the
--      moment the server (whose own clock is authoritative and drives
--      advance_match_phases()) has already flipped matches.status to
--      "submitting" and pushed that over realtime/poll,
--   3. which in turn unmounts the drawing canvas (see app/match/[id].tsx's
--      showCanvas) before the delayed local capture/whistle logic runs,
--      producing a null canvas ref ("Could not capture drawing") and a
--      whistle-fire condition that's already false by the time it's checked.
--
-- This RPC lets the client measure its own clock offset against the DB's
-- clock (the same clock advance_match_phases() uses for drawing_ends_at),
-- so useServerCountdown can correct for it. See
-- src/features/match/clockOffset.ts for how the client uses this.
create or replace function public.server_time()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

grant execute on function public.server_time() to authenticated, anon;
