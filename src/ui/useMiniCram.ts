import { useCallback, useRef, useState } from 'react';
import { afterAnswer, afterReturn, markCram, nextReturn, unmarkCram, emptyMiniCram, type MiniCram, type MiniCramEntry } from '../core/miniCram';

export interface MiniCramHook {
  /** The card whose return is on screen, if one is. */
  showing: string | undefined;
  /** Returns answered so far: part of a showing's key, since a return doesn't add to the answers given. */
  returnsAnswered: number;
  entry: (id: string) => MiniCramEntry | undefined;
  /** Marks the card, or unmarks it when it is. `answered`: it has been answered already this session. */
  toggle: (id: string, answered: boolean) => void;
  /** A real answer was given. Returns the card to show next when a return is due, which is then `showing`. */
  answered: (id: string, rating: number, nothingElse: boolean, usable: (id: string) => boolean) => string | undefined;
  /** The return on screen was answered. Returns the next return to show, if one is due. */
  returned: (id: string, got: boolean, nothingElse: boolean, usable: (id: string) => boolean) => string | undefined;
  /** Drops the return on screen (an undo, say). */
  clearShowing: () => void;
}

/**
 * Review's mini cram (src/core/miniCram.ts): the marked cards and the return on screen, for this
 * session only. Kept in a ref as well as state, so two taps in one frame see the same answer.
 */
export function useMiniCram(): MiniCramHook {
  const ref = useRef<MiniCram>(emptyMiniCram());
  const [state, setState] = useState<MiniCram>(ref.current);
  const showingRef = useRef<string | undefined>(undefined);
  const [showing, setShowingState] = useState<string>();
  const [returnsAnswered, setReturnsAnswered] = useState(0);
  const apply = useCallback((next: MiniCram) => { ref.current = next; setState(next); }, []);
  const show = useCallback((id: string | undefined) => { showingRef.current = id; setShowingState(id); }, []);

  const toggle = useCallback((id: string, answered: boolean) => {
    apply(ref.current.cards[id] ? unmarkCram(ref.current, id) : markCram(ref.current, id, answered));
    if (showingRef.current === id && !ref.current.cards[id]) show(undefined);
  }, [apply, show]);

  const answered = useCallback((id: string, rating: number, nothingElse: boolean, usable: (id: string) => boolean) => {
    apply(afterAnswer(ref.current, id, rating));
    const next = nextReturn(ref.current, { ignoreWait: nothingElse, justShown: id, usable });
    show(next);
    return next;
  }, [apply, show]);

  const returned = useCallback((id: string, got: boolean, nothingElse: boolean, usable: (id: string) => boolean) => {
    if (showingRef.current !== id) return undefined;
    apply(afterReturn(ref.current, id, got));
    setReturnsAnswered((n) => n + 1);
    const next = nextReturn(ref.current, { ignoreWait: nothingElse, justShown: id, usable });
    show(next);
    return next;
  }, [apply, show]);

  return { showing, returnsAnswered, entry: (id) => state.cards[id], toggle, answered, returned, clearShowing: useCallback(() => show(undefined), [show]) };
}
