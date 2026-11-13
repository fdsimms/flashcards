import { useCallback, useEffect, useRef } from 'react';
import { decodeDeckSnapshot, encodeDeckSnapshot } from '../core/deckSnapshot';
import type { DeckRow } from '../core/deckTree';
import type { BackupStore } from '../db/sqliteRepo';
import type { CollapsedDecks } from './useCollapsedDecks';

/**
 * Shows the deck list, and which decks are collapsed, as they were last loaded the moment the app
 * opens. The real loads read the Anki collection, which waits while the sync that starts at launch
 * holds it, so without this the list is empty until the sync ends. `save` is called with each real
 * load; once one has landed, a snapshot read late is dropped.
 */
export function useDeckSnapshot(repo: BackupStore | null, setDecks: (rows: DeckRow[]) => void, collapse: CollapsedDecks) {
  const fresh = useRef(false);
  const last = useRef<{ rows: DeckRow[]; now: Date; hour: number } | null>(null);
  const { seed, collapsed } = collapse;
  useEffect(() => {
    if (!repo) return;
    repo.deckListSnapshot().then((raw) => {
      const saved = decodeDeckSnapshot(raw, new Date());
      if (!saved || fresh.current) return;
      setDecks(saved.decks);
      seed(saved.collapsed);
    }).catch(() => undefined);
  }, [repo, setDecks, seed]);
  const write = useCallback((set: Set<string>) => {
    const l = last.current;
    if (l) repo?.saveDeckListSnapshot(encodeDeckSnapshot(l.rows, set, l.now, l.hour)).catch(() => undefined);
  }, [repo]);
  const save = useCallback((rows: DeckRow[], now: Date, dayStartsAtHour: number) => {
    fresh.current = true;
    last.current = { rows, now, hour: dayStartsAtHour };
    write(collapsedRef.current);
  }, [write]);
  // A collapse or expand, or the read that follows a sync, is saved with the rows.
  const collapsedRef = useRef(collapsed);
  useEffect(() => { collapsedRef.current = collapsed; write(collapsed); }, [collapsed, write]);
  return { save };
}
