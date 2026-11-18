import { useCallback, useEffect, useReducer } from 'react';
import { close, dismissed, emptyQueue, request, type SheetQueue } from '../core/sheetQueue';

type Action<S extends { key: string }> =
  | { type: 'request'; sheet: S }
  | { type: 'close'; key: string }
  | { type: 'dismissed'; key: string };

function reduce<S extends { key: string }>(q: SheetQueue<S>, a: Action<S>): SheetQueue<S> {
  return a.type === 'request' ? request(q, a.sheet) : a.type === 'close' ? close(q, a.key) : dismissed(q, a.key);
}

// How long to wait for iOS to report a dismissal before going on without it. A sheet that never
// finished presenting never reports one, and the queue must not wait on it forever.
const DISMISS_GIVE_UP_MS = 1500;

/**
 * The sheets Review can raise, one at a time (src/core/sheetQueue.ts for why). `head` is the one
 * to render, in the same place on every screen state, with `visible` false while it is leaving;
 * give its Modal `onDismiss={dismissed}`.
 */
export function useSheetQueue<S extends { key: string }>() {
  const [q, dispatch] = useReducer(reduce as (q: SheetQueue<S>, a: Action<S>) => SheetQueue<S>, undefined, emptyQueue<S>);
  const head = q.items[0];
  const headKey = head?.key;

  useEffect(() => {
    if (!q.leaving || !headKey) return;
    const id = setTimeout(() => dispatch({ type: 'dismissed', key: headKey }), DISMISS_GIVE_UP_MS);
    return () => clearTimeout(id);
  }, [q.leaving, headKey]);

  return {
    head,
    visible: !q.leaving,
    request: useCallback((sheet: S) => dispatch({ type: 'request', sheet }), []),
    close: useCallback((key: string) => dispatch({ type: 'close', key }), []),
    dismissed: useCallback((key: string) => dispatch({ type: 'dismissed', key }), []),
  };
}
