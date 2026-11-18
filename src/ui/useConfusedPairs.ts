import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newPair, partnerIndex, withoutPair, withPair, type ConfusedPair } from '../core/confusedPairs';
import type { Repo } from '../db/repo';

/**
 * Review's side of confused words (src/core/confusedPairs.ts): the pairs, read once when the
 * screen opens (Review's sheet queue says which note the link sheet is open for). A link is written to SQLite first, then
 * put in state, so a crash between the two loses the screen's copy, not the link.
 */
export function useConfusedPairs(repo: Repo) {
  const [pairs, setPairs] = useState<ConfusedPair[]>([]);
  // Counts links and unlinks, so a load that began before one is read again instead of put over it.
  const changes = useRef(0);

  useEffect(() => {
    let stale = false;
    (async () => {
      for (;;) {
        const seen = changes.current;
        const loaded = await repo.listConfusedPairs();
        if (stale) return;
        if (changes.current !== seen) continue;
        setPairs(loaded);
        return;
      }
    })().catch(() => {
      // Pairs that can't load are left off; answering still works.
    });
    return () => { stale = true; };
  }, [repo]);

  const partners = useMemo(() => partnerIndex(pairs), [pairs]);

  /** Links two notes. Throws when it can't be saved, and the sheet says so. */
  const link = useCallback(async (x: string, y: string) => {
    const pair = newPair(x, y, new Date());
    if (!pair) return;
    changes.current++;
    try {
      await repo.saveConfusedPair(pair);
    } finally {
      changes.current++;
    }
    setPairs((p) => withPair(p, pair));
  }, [repo]);

  /** Takes a link away. */
  const unlink = useCallback(async (x: string, y: string) => {
    changes.current++;
    try {
      await repo.deleteConfusedPair(x, y);
    } finally {
      changes.current++;
    }
    setPairs((p) => withoutPair(p, x, y));
  }, [repo]);

  return { pairs, partners, link, unlink };
}
