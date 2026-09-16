import { supabase } from "@/lib/supabase";

// Corrects for client/server clock skew in the match timers. Root cause of
// the linked "timer off by a few seconds" / "whistle doesn't play" /
// "Could not capture drawing" bugs (2026-09-13) — see the comment in
// 20260913000000_server_time_rpc.sql for the full chain. useServerCountdown
// reads offsetMs (via getClockOffsetMs()) instead of trusting the device's
// raw Date.now() against the server-issued drawing_ends_at/countdown_ends_at.
//
// Module-level state on purpose: there's one true offset for this device's
// clock at any moment, shared by every countdown on screen (drawing +
// countdown clocks both call useServerCountdown), so there's nothing to gain
// from scoping this per-hook-instance.
let offsetMs = 0;

export function getClockOffsetMs(): number {
  return offsetMs;
}

// Measures (serverNow - clientNow), RTT-corrected by assuming the request
// and response legs took equal time (the usual sampling-clock-offset
// approximation — good enough here; we're correcting a multi-second skew,
// not chasing sub-100ms precision). Call this on mount and resync on the
// same cadence as the match screen's existing 2s poll, per R1.2's "resynced
// at least every 15s" — 2s is well inside that and costs one lightweight
// RPC call already in the same request wave as the poll's getMatch().
export async function syncClockOffset(): Promise<void> {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc("server_time");
  const t1 = Date.now();
  if (error || !data) return; // best-effort: keep the last known-good offset
  const serverNow = new Date(data as string).getTime();
  const roundTrip = t1 - t0;
  offsetMs = serverNow - (t0 + roundTrip / 2);
}
