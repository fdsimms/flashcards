import { useCallback, useEffect, useState } from 'react';
import { failureText } from '../core/failure';
import { openRepo } from '../db/sqliteRepo';
import type { AppRepo } from './AppContext';

/**
 * Opens the database for AppContext. A failure (a migration that can't run, a file that can't be
 * read) is said, with Try again, rather than leaving the app on a spinner with nothing to tap.
 */
export function useOpenRepo(): { repo: AppRepo | null; error: string | null; retry: () => void } {
  const [repo, setRepo] = useState<AppRepo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setError(null);
    openRepo().then(setRepo, (e) => setError(failureText(e, { what: "Couldn't open Franki's data.", next: 'Try again, or restart the app.' })));
  }, [attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { repo, error, retry };
}
