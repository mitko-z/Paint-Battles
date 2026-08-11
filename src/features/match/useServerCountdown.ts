import { useEffect, useState } from "react";

/** Countdown to an absolute server timestamp (ISO). */
export function useServerCountdown(endsAt: string | null | undefined) {
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (!endsAt) {
      setRemainingMs(0);
      return;
    }

    const tick = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      setRemainingMs(Math.max(0, diff));
    };

    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endsAt]);

  return {
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    isDone: remainingMs <= 0 && Boolean(endsAt),
  };
}
