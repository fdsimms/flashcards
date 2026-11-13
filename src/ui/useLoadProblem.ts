import { useCallback, useState } from 'react';
import { failureText } from '../core/failure';

/**
 * Why the deck list's last load failed, if it did. `guard` runs a load, clearing the problem when
 * it works and keeping the reason when it doesn't, so a failed read of the database is shown on the
 * deck list rather than leaving its rows quietly out of date.
 */
export function useLoadProblem() {
  const [problem, setProblem] = useState<string>();
  const guard = useCallback(async (load: () => Promise<void>) => {
    try {
      await load();
      setProblem(undefined);
    } catch (e) {
      // The banner's own title says what failed and its action says to tap.
      setProblem(failureText(e, { next: 'The decks shown may be out of date.' }));
    }
  }, []);
  return { problem, guard };
}
