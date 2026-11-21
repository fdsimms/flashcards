import { nextStudyDayStart } from '../core/day';
import { Refusal } from '../core/failure';
import { ankiToday } from '../core/order';
import { forgetCard, pickDays, setDueCard, type DueDateSpec } from '../core/reschedule';
import type { Card } from '../core/types';
import type { SyncDb } from './sync/collectionSync';
import { schedFromAnki, type AnkiDays } from '../import/ankiJson';
import { readCardRows, readConfigRow, type AnkiActionUndo } from './cardUndo';
import type { NoteStore } from './noteService';
import { forgetAnkiCards, setAnkiDueDates, type RescheduledRow, type RescheduledRows } from './rescheduleWrites';

/**
 * Forget and Set Due Date for cards picked in Franki: an Anki card is changed in the kept
 * collection as Anki changes it (rescheduleWrites.ts), then read back into Franki the way an
 * import reads it, so Franki and Anki agree; a Franki-only card is changed in Franki
 * (src/core/reschedule.ts). Each returns what undoes it in the kept collection (`anki`), which
 * Review keeps for its Undo (src/anki/cardUndo.ts).
 */

/** The cards as changed, and what undoes the change in the kept collection when it made one there. */
export interface Rescheduled { cards: Card[]; anki?: AnkiActionUndo }

/** Why the change can't be made, with what to do, to show as it is. */
export class RescheduleRefused extends Refusal {}

/** A card as Franki keeps it, from its Anki row after the change. */
function fromAnkiRow(card: Card, row: RescheduledRow, days: AnkiDays, now: Date): Card {
  let data: { s?: unknown; d?: unknown; lrt?: unknown } = {};
  try { data = row.data ? JSON.parse(row.data) : {}; } catch { /* no memory state */ }
  const sched = schedFromAnki({
    cardId: card.ankiId!, note: card.noteId, deckName: '', type: row.type, due: row.due, interval: row.ivl, factor: row.factor,
    reps: row.reps, lapses: row.lapses,
    memoryState: typeof data.s === 'number' && typeof data.d === 'number' ? { stability: data.s, difficulty: data.d } : undefined,
    // As the importer reads it (collection.ts): the card's own last answer, else its latest answer in the review log.
    lastReview: typeof data.lrt === 'number' ? data.lrt : row.lastAnsweredId !== null ? Math.floor(row.lastAnsweredId / 1000) : undefined,
  }, days, now);
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
  inAnki: (db: SyncDb, cids: number[]) => Promise<RescheduledRows>,
  inFranki: (card: Card) => Card,
  /** Config values the change can move, kept as they were for undo. */
  configKeys: string[] = [],
): Promise<Rescheduled> {
  const cs = await store.collectionSettings();
  const anki = (await store.keptCollection()) ? cards.filter((c) => c.ankiId) : [];
  let undo: AnkiActionUndo | undefined;
  const rows = anki.length ? await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const cids = anki.map((c) => Number(c.ankiId));
    const before = await readCardRows(db, cids);
    const config = [];
    for (const key of configKeys) config.push(await readConfigRow(db, key));
    const changed = await inAnki(db, cids);
    undo = { cards: before.filter((r) => changed.has(r.cid)), revlogIds: [...changed.values()].map((r) => r.revlogId), config };
    return changed;
  })) : new Map() as RescheduledRows;
  const out = cards.map((c) => {
    const row = c.ankiId ? rows.get(Number(c.ankiId)) : undefined;
    return row ? fromAnkiRow(c, row, cs, now) : inFranki(c);
  });
  for (const c of out) await store.saveCard(c);
  return { cards: out, anki: undo };
}

/** Anki's Forget: the cards are new again, back at the position they had when new where there was one. */
export async function forgetCards(store: NoteStore, cards: Card[], opts: { resetCounts: boolean }, now: Date = new Date()): Promise<Rescheduled> {
  return reschedule(store, cards, now,
    (db, cids) => forgetAnkiCards(db, cids, { restorePosition: true, resetCounts: opts.resetCounts }, now),
    (c) => forgetCard(c, opts, now), ['nextPos']);
}

/** Anki's Set Due Date: the cards become reviews due in `spec`'s days (each picked afresh from a range). */
export async function setDueDates(store: NoteStore, cards: Card[], spec: DueDateSpec, now: Date = new Date(), random: () => number = Math.random): Promise<Rescheduled> {
  const cs = await store.collectionSettings();
  const H = cs.dayStartsAtHour;
  const today = ankiToday(now, H, cs.collectionCreated, cs.creationOffset);
  if (today === undefined && (await store.keptCollection()) && cards.some((c) => c.ankiId)) {
    throw new RescheduleRefused("Franki doesn't know when your Anki collection was created. Sync once, then try again.");
  }
  return reschedule(store, cards, now,
    (db, cids) => setAnkiDueDates(db, cids, {
      today: today!, nextDayStartSecs: Math.floor(nextStudyDayStart(now, H).getTime() / 1000), days: () => pickDays(spec, random), forceReset: spec.forceReset,
    }, now),
    (c) => setDueCard(c, pickDays(spec, random), now, H));
}
