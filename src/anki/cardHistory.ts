import { historyFromReviews, historyFromRevlog, type AnkiLogRow, type HistoryEntry } from '../core/cardInfo';
import type { Card } from '../core/types';
import type { NoteStore } from './noteService';

/**
 * A card's history for Card Info: an Anki card's from the kept collection's review log, which holds
 * answers from every device (Franki writes its own there too), else Franki's own table.
 */
export async function cardHistory(store: Pick<NoteStore, 'keptCollection' | 'lockAnki' | 'withSyncConnection' | 'listReviews'>, card: Card): Promise<HistoryEntry[]> {
  if (card.ankiId && (await store.keptCollection())) {
    const rows = await store.lockAnki(() => store.withSyncConnection((db) =>
      db.all<AnkiLogRow>('SELECT id, ease, ivl, time, type FROM revlog WHERE cid = ?', Number(card.ankiId))));
    return historyFromRevlog(rows);
  }
  return historyFromReviews(await store.listReviews(new Date(0)), card.id);
}
