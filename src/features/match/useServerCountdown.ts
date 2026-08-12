import { useEffect, useState } from "react";

function msUntil(endsAt: string | null | undefined, now: number): number {
  if (!endsAt) return 0;
  return Math.max(0, new Date(endsAt).getTime() - now);
}

/** Countdown to an absolute server timestamp (ISO). */
export function useServerCountdown(endsAt: string | null | undefined) {
  // Tick forces re-renders; remaining time is derived synchronously from Date.now()
  // so the first paint after `endsAt` is set never falsely reports isDone.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [endsAt]);

  const remainingMs = msUntil(endsAt, Date.now());

  return {
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    isDone: Boolean(endsAt) && remainingMs <= 0,
  };
}
