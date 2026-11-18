import { useEffect, useState } from 'react';

/** The longest Today holds its first paint for what it's waiting on (ms): a slow server or a sync holding the collection mustn't leave it blank. */
export const TODAY_HOLD_MS = 1500;

/**
 * Whether Today can show: once everything it's waiting on is in (`waitingOn` all true), or
 * `TODAY_HOLD_MS` after it opened, whichever is first. Latches, so a later reload of one piece
 * never takes the screen away again.
 */
export function useTodayReady(waitingOn: boolean[], holdMs = TODAY_HOLD_MS): boolean {
  const [ready, setReady] = useState(false);
  const allIn = waitingOn.every(Boolean);
  useEffect(() => {
    if (ready) return undefined;
    if (allIn) { setReady(true); return undefined; }
    const timer = setTimeout(() => setReady(true), holdMs);
    return () => clearTimeout(timer);
  }, [ready, allIn, holdMs]);
  return ready;
}
