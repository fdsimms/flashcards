import { useCallback, useEffect, useRef, useState } from 'react';
import { withAnswer, withoutLastAnswer, type MissLog } from '../core/misses';
import type { Repo } from '../db/repo';

/**
 * What Review needs to remind about earlier misses (src/core/misses.ts): each card's answers, read
 * once when the screen opens and kept in step as answers are given and taken back. The reasons
 * themselves are on the review rows, so an undo that deletes the row has taken its reason back.
 */
export function useMissMarks(repo: Repo) {
  const [log, setLog] = useState<MissLog>(new Map());
  // Counts answers and undos, so a load that began before one is read again instead of put over it.
  const changes = useRef(0);

  useEffect(() => {
    let stale = false;
    (async () => {
      for (;;) {
        const seen = changes.current;
        const answers = await repo.listMissAnswers();
        if (stale) return;
        if (changes.current !== seen) continue;
        const next: MissLog = new Map();
        for (const a of answers) next.set(a.cardId, [...(next.get(a.cardId) ?? []), a.miss]);
        setLog(next);
        return;
      }
    })().catch(() => {
      // A reminder that can't load is left off; answering still works.
    });
    return () => { stale = true; };
  }, [repo]);

  /** An answer was written: `miss` is its reason, if it had one. */
  const answered = useCallback((cardId: string, miss: string | undefined) => {
    changes.current++;
    setLog((l) => withAnswer(l, cardId, miss));
  }, []);
  /** The card's latest answer was undone. */
  const undone = useCallback((cardId: string) => {
    changes.current++;
    setLog((l) => withoutLastAnswer(l, cardId));
  }, []);

  return { log, answered, undone };
}
