import { useCallback, useEffect, useRef } from 'react';
import { decodeDeckSnapshot, encodeDeckSnapshot } from '../core/deckSnapshot';
import type { DeckRow } from '../core/deckTree';
import type { BackupStore } from '../db/sqliteRepo';

/**
 * Shows the deck list as it was last loaded the moment the app opens. The real load reads the
 * Anki collection, which waits while the sync that starts at launch holds it, so without this the
 * list is empty until the sync ends. `save` is called with each real load; once one has landed, a
 * snapshot read late is dropped.
 */
export function useDeckSnapshot(repo: BackupStore | null, setDecks: (rows: DeckRow[]) => void) {
  const fresh = useRef(false);
  useEffect(() => {
    if (!repo) return;
    repo.deckListSnapshot().then((raw) => {
      const rows = decodeDeckSnapshot(raw, new Date());
      if (rows && !fresh.current) setDecks(rows);
    }).catch(() => undefined);
  }, [repo, setDecks]);
  const save = useCallback((rows: DeckRow[], now: Date, dayStartsAtHour: number) => {
    fresh.current = true;
    repo?.saveDeckListSnapshot(encodeDeckSnapshot(rows, now, dayStartsAtHour)).catch(() => undefined);
  }, [repo]);
  return { save };
}
