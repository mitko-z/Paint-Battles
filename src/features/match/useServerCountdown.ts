import { useEffect, useState } from "react";
import { getClockOffsetMs } from "./clockOffset";

function msUntil(endsAt: string | null | undefined, now: number): number {
  if (!endsAt) return 0;
  return Math.max(0, new Date(endsAt).getTime() - now);
}

/**
 * Countdown to an absolute server timestamp (ISO).
 *
 * `endsAt` comes from the server's clock (matches.drawing_ends_at /
 * countdown_ends_at, set via Postgres `now()`). Comparing it against the
 * device's raw Date.now() assumes the two clocks agree, which real devices
 * don't reliably do — see clockOffset.ts for the bug this caused. `+
 * getClockOffsetMs()` reprojects the device's clock onto the server's, so
 * `remainingMs`/`isDone` track real elapsed server time rather than
 * whatever this device's clock happens to read.
 */
export function useServerCountdown(endsAt: string | null | undefined) {
  // Tick forces re-renders; remaining time is derived synchronously from
  // the (offset-corrected) clock so the first paint after `endsAt` is set
  // never falsely reports isDone.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [endsAt]);

  const remainingMs = msUntil(endsAt, Date.now() + getClockOffsetMs());

  return {
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    isDone: Boolean(endsAt) && remainingMs <= 0,
  };
}
