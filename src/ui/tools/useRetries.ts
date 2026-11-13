import { useMemo, useRef } from 'react';
import { nextQuestion, noRetries, queueMiss, type Retries } from '../../tools/retry';

/**
 * A tool's missed questions, to hand each back once a few questions later (retry.ts). Held in a
 * ref, not state: nothing on screen shows the queue, and a mark and the next question come in
 * the same tap, so the second has to see what the first queued. `scope` is what the questions are
 * asked in (the language, the mode); a question missed in one isn't handed back in another.
 */
export function useRetries<T>() {
  const held = useRef<Retries<T>>(noRetries());
  return useMemo(() => ({
    /** A miss of `item`, which `key` tells from other questions. */
    missed: (scope: string, key: string, item: T) => { held.current = queueMiss(held.current, scope, key, item); },
    /** The question after the one keyed `currentKey`: a missed one that's due, else `draw`'s. */
    next: (scope: string, currentKey: string | undefined, draw: () => T): T => {
      const { item, retries } = nextQuestion(held.current, scope, currentKey, draw);
      held.current = retries;
      return item;
    },
  }), []);
}
