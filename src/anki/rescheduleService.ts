import { nextStudyDayStart } from '../core/day';
import { ankiToday } from '../core/order';
import { forgetCard, pickDays, setDueCard, type DueDateSpec } from '../core/reschedule';
import type { Card } from '../core/types';
import { schedFromAnki } from '../import/ankiJson';
import type { NoteStore } from './noteService';
import { forgetAnkiCards, setAnkiDueDates, type RescheduledRow, type RescheduledRows } from './rescheduleWrites';

/**
 * Forget and Set Due Date for cards picked in Franki: an Anki card is changed in the kept
 * collection as Anki changes it (rescheduleWrites.ts), then read back into Franki the way an
 * import reads it, so Franki and Anki agree; a Franki-only card is changed in Franki
 * (src/core/reschedule.ts). Neither is undone by Review's Undo, as in Anki's reviewer once
 * another card is shown.
 */

/** Why the change can't be made, with what to do, to show as it is. */
export class RescheduleRefused extends Error {}

/** A card as Franki keeps it, from its Anki row after the change. */
function fromAnkiRow(card: Card, row: RescheduledRow, crt: number | undefined, now: Date): Card {
  let data: { s?: unknown; d?: unknown; lrt?: unknown } = {};
  try { data = row.data ? JSON.parse(row.data) : {}; } catch { /* no memory state */ }
  const sched = schedFromAnki({
    cardId: card.ankiId!, note: card.noteId, deckName: '', type: row.type, due: row.due, interval: row.ivl, factor: row.factor,
    reps: row.reps, lapses: row.lapses,
    memoryState: typeof data.s === 'number' && typeof data.d === 'number' ? { stability: data.s, difficulty: data.d } : undefined,
    // As the importer reads it (collection.ts): the card's own last answer, else its latest review log row.
    lastReview: typeof data.lrt === 'number' ? data.lrt : Math.floor(row.revlogId / 1000),
  }, crt, now);
  return {
    ...card,
    // Both put the card in an ordinary queue at home, out of any bury, suspension or filtered deck.
    suspended: false, buriedAt: undefined, filteredDeck: undefined, filteredDue: undefined, previewDue: undefined,
    position: row.type === 0 ? row.due : undefined,
    ankiMod: row.mod,
    sched,
  };
}

async function reschedule(
  store: NoteStore, cards: Card[], now: Date,
  inAnki: (cids: number[]) => Promise<RescheduledRows>,
  inFranki: (card: Card) => Card,
): Promise<Card[]> {
  const cs = await store.collectionSettings();
  const anki = (await store.keptCollection()) ? cards.filter((c) => c.ankiId) : [];
  const rows = anki.length ? await store.lockAnki(() => inAnki(anki.map((c) => Number(c.ankiId)))) : new Map() as RescheduledRows;
  const out = cards.map((c) => {
    const row = c.ankiId ? rows.get(Number(c.ankiId)) : undefined;
    return row ? fromAnkiRow(c, row, cs.collectionCreated, now) : inFranki(c);
  });
  for (const c of out) await store.saveCard(c);
  return out;
}

/** Anki's Forget: the cards are new again, back at the position they had when new where there was one. */
export async function forgetCards(store: NoteStore, cards: Card[], opts: { resetCounts: boolean }, now: Date = new Date()): Promise<Card[]> {
  return reschedule(store, cards, now,
    (cids) => store.withSyncConnection((db) => forgetAnkiCards(db, cids, { restorePosition: true, resetCounts: opts.resetCounts }, now)),
    (c) => forgetCard(c, opts, now));
}

/** Anki's Set Due Date: the cards become reviews due in `spec`'s days (each picked afresh from a range). */
export async function setDueDates(store: NoteStore, cards: Card[], spec: DueDateSpec, now: Date = new Date(), random: () => number = Math.random): Promise<Card[]> {
  const cs = await store.collectionSettings();
  const H = cs.dayStartsAtHour;
  const today = ankiToday(now, H, cs.collectionCreated, cs.creationOffset);
  if (today === undefined && (await store.keptCollection()) && cards.some((c) => c.ankiId)) {
    throw new RescheduleRefused("Franki doesn't know when your Anki collection was created. Sync once, then try again.");
  }
  return reschedule(store, cards, now,
    (cids) => store.withSyncConnection((db) => setAnkiDueDates(db, cids, {
      today: today!, nextDayStartSecs: Math.floor(nextStudyDayStart(now, H).getTime() / 1000), days: () => pickDays(spec, random), forceReset: spec.forceReset,
    }, now)),
    (c) => setDueCard(c, pickDays(spec, random), now, H));
}
