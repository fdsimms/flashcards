import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { timeboxMessage, timeboxReached } from '../core/session';

/**
 * Anki's session time limit (its timebox): once `limitSecs` have passed since the stretch began,
 * the next answer brings an alert saying how many cards were studied in it. Keep studying starts the
 * next stretch from then; Stop calls `onStop`. `answered` is the answers standing in the session,
 * checked each time it changes, as Anki checks after each answer. Nothing with no limit.
 */
export function useTimebox(limitSecs: number | undefined, answered: number, onStop: () => void) {
  const start = useRef({ at: Date.now(), answered });
  const asking = useRef(false);
  useEffect(() => {
    const now = Date.now();
    if (asking.current || !timeboxReached(start.current.at, now, limitSecs)) return;
    asking.current = true;
    const cards = Math.max(0, answered - start.current.answered);
    Alert.alert('Time limit reached', timeboxMessage(cards, now - start.current.at), [
      { text: 'Stop', style: 'cancel', onPress: () => { asking.current = false; onStop(); } },
      { text: 'Keep studying', onPress: () => { asking.current = false; start.current = { at: Date.now(), answered }; } },
    ]);
  }, [answered, limitSecs]); // eslint-disable-line react-hooks/exhaustive-deps
}
