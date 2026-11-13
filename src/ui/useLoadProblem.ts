import { useCallback, useState } from 'react';

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
      setProblem(`${e instanceof Error ? e.message : String(e)} Tap to try again.`);
    }
  }, []);
  return { problem, guard };
}
