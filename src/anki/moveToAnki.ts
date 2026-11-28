import { isOmnilanguage } from '../core/cards';
import { cardHomeDeck } from '../core/deckTree';
import { DEFAULT_LEARN_STEPS, DEFAULT_RELEARN_STEPS, paramsForDeck } from '../core/scheduler';
import type { Card, DeckParams, Note, NoteType, ReviewLogEntry } from '../core/types';
import { omnilanguageKindByOrd } from '../import/models';
import { ankiDeckIdOrCreate } from './deckEdits';
import { deckAndParents, studiedDelta, withStudied, type DeckStatsRow } from './deckStats';
import { ordOf, type NoteStore } from './noteService';
import { ankiNoteType, insertAnkiNote, type AnkiNoteType } from './noteWrites';
import type { SyncDb } from './sync/collectionSync';
import { notesWithFirstField } from './textImportWrites';
import {
  ankiDayNumber, CARD_ROW_SQL, CARD_UPDATE_SQL, cardUpdate, cardUpdateParams, COL_MODIFIED_SQL, REVLOG_INSERT_SQL, revlogEntry, revlogParams,
  type AnkiCardRow, type AnkiClock, type AnkiRevlogRow,
} from './writeback';

/**
 * Moving the words that live in Franki only (a word list imported before imports went into Anki)
 * into the kept collection, with their progress, so every device has them (Settings, Anki).
 *
 * Each note is added as Anki adds one (`insertAnkiNote`, its deck made if Anki lacks it), then each
 * card is given its schedule as an answer writes one (`cardUpdate`), and its past answers become
 * review log rows (`historyRevlog`), rebuilt from Franki's own log: their ratings and times are
 * exact, which is what Anki's FSRS reads from history; how long each took isn't kept, so it's 0, and
 * the intervals are read off the due dates. Today's answers are added to the decks' "studied today"
 * counts, which Anki's limits (and Franki's, once a card is Anki's) read. Franki's cards then take
 * the new Anki ids, and the decks are read in again (`refreshFromKeptCollection`), matched by those
 * ids (`reconcileIds`). Everything in the collection happens in one transaction.
 *
 * A note is left in Franki, with the reason, when Anki has no note type by its name, already has a
 * note of that type with the same first field, or would give its cards other kinds than Franki has
 * (their ids would change on the way back, orphaning their history): `moveCheck` decides, for the
 * count Settings shows and for the move alike.
 */

/** The notes no card of which is in the Anki collection, with their cards (retired ones too, which stay in Franki). */
export function frankiOnlyNotes(notes: Note[], cards: Card[]): { note: Note; cards: Card[] }[] {
  const byNote = new Map<string, Card[]>();
  for (const c of cards) (byNote.get(c.noteId) ?? byNote.set(c.noteId, []).get(c.noteId)!).push(c);
  return notes
    .map((note) => ({ note, cards: byNote.get(note.id) ?? [] }))
    .filter((x) => x.cards.some((c) => !c.retired) && x.cards.every((c) => !c.ankiId));
}

/** The kind Anki's cards come back to Franki as: Omnilanguage's by template, any other `t<ord>`. */
function kindOfOrd(note: Note, ord: number): string {
  return isOmnilanguage(note) ? omnilanguageKindByOrd[ord] ?? '' : `t${ord}`;
}

/** Why a note can't move into the collection, or its note type there when it can. */
export async function moveCheck(db: SyncDb, note: Note, cards: Card[], noteTypes: Map<string, NoteType>): Promise<{ noteType: AnkiNoteType } | { reason: string }> {
  const noteType = await ankiNoteType(db, note.model, noteTypes.get(note.model)?.fields ?? Object.keys(note.fields));
  if (!noteType) return { reason: `the Anki collection has no note type called "${note.model}"` };
  const live = cards.filter((c) => !c.retired);
  if (live.some((c) => kindOfOrd(note, ordOf(note, c.kind)) !== c.kind)) return { reason: `its cards don't match the card types of "${note.model}" in Anki` };
  const first = noteType.fieldNames[0];
  if (first && (await notesWithFirstField(db, noteType, note.fields[first] ?? '')).length) return { reason: `Anki already has a note with this ${first}` };
  return { noteType };
}

/** A day count between two moments as Anki numbers its days. */
const daysBetween = (from: string, to: string, clock: AnkiClock) =>
  Math.max(0, ankiDayNumber(Math.floor(Date.parse(to) / 1000), clock) - ankiDayNumber(Math.floor(Date.parse(from) / 1000), clock));

/**
 * A card's past answers as Anki's review log rows (`revlogEntry`), oldest first, each with the time
 * it was given (`at`, ms). A row of Franki's log holds the card's state before the answer and the due
 * date after it, so each answer's before is read from its own row and the one before, and its after
 * from the next row, or the card as it is now for the last. A card that is new again after answers
 * (Forget, which logs nothing in Franki) ends with the reset row Anki's Forget writes.
 */
export function historyRevlog(card: Card, reviews: ReviewLogEntry[], clock: AnkiClock): (Omit<AnkiRevlogRow, 'id' | 'cid'> & { at: number })[] {
  const rows = [...reviews].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  const out: (Omit<AnkiRevlogRow, 'id' | 'cid'> & { at: number })[] = [];
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const before: Card = {
      ...card,
      sched: {
        ...card.sched, state: r.state, stability: r.stability, difficulty: r.difficulty,
        due: prev?.due ?? r.reviewedAt, lastReview: prev?.reviewedAt ?? null, scheduledDays: prev ? daysBetween(prev.reviewedAt, prev.due, clock) : 0,
      },
    };
    const after: Card = {
      ...card,
      sched: {
        ...card.sched,
        state: next ? next.state : card.sched.state,
        stability: next ? next.stability : card.sched.stability,
        difficulty: next ? next.difficulty : card.sched.difficulty,
        due: r.due, lastReview: r.reviewedAt, scheduledDays: daysBetween(r.reviewedAt, r.due, clock),
      },
    };
    const at = Date.parse(r.reviewedAt);
    const { id: _id, cid: _cid, ...entry } = revlogEntry(before, after, r.rating, { id: 0, cid: 0, previousIvl: before.sched.scheduledDays, now: new Date(at), takenMs: 0, clock });
    out.push({ ...entry, at });
  });
  const last = out.at(-1);
  if (last && card.sched.state === 0) out.push({ usn: -1, ease: 0, ivl: 0, lastIvl: last.ivl, factor: 0, time: 0, type: 4, at: last.at + 1 });
  return out;
}

export interface MoveResult {
  moved: number;
  /** The words left in Franki, each with why. */
  left: { word: string; reason: string }[];
}

const DECKS_SQL = 'SELECT id, name, mtime_secs, usn, common FROM decks NOT INDEXED';
const DECK_STATS_UPDATE_SQL = 'UPDATE decks SET common = ?, mtime_secs = ?, usn = ? WHERE id = ?';

/** The words `moveToAnki` would move now: what Settings, Anki offers. */
export async function countMovable(store: NoteStore): Promise<number> {
  if (!(await store.keptCollection())) return 0;
  const candidates = frankiOnlyNotes(await store.listNotes(), await store.listCards());
  if (!candidates.length) return 0;
  const noteTypes = await store.listNoteTypes();
  return store.withSyncConnection(async (db) => {
    let n = 0;
    for (const { note, cards } of candidates) if ('noteType' in (await moveCheck(db, note, cards, noteTypes))) n++;
    return n;
  });
}

const wordOf = (note: Note) => (note.fields.Entry ?? Object.values(note.fields)[0] ?? note.id).replace(/<[^>]*>/g, '').trim();

/** Moves every word `countMovable` counts into the collection, and says which were left and why. */
export async function moveToAnki(store: NoteStore, refresh: () => Promise<void>, now: Date = new Date()): Promise<MoveResult> {
  if (!(await store.keptCollection())) return { moved: 0, left: [] };
  const [notes, cards, noteTypes, params, cs] = await Promise.all([store.listNotes(), store.listCards(), store.listNoteTypes(), store.listDeckParams(), store.collectionSettings()]);
  const candidates = frankiOnlyNotes(notes, cards)
    // In the order their new cards come up, so Anki's new-card positions keep it.
    .sort((a, b) => Math.min(...a.cards.map((c) => c.position ?? Infinity)) - Math.min(...b.cards.map((c) => c.position ?? Infinity)));
  if (!candidates.length) return { moved: 0, left: [] };
  const ids = new Set(candidates.flatMap((x) => x.cards.map((c) => c.id)));
  const reviewsOf = new Map<string, ReviewLogEntry[]>();
  for (const r of await store.listReviews(new Date(0))) if (ids.has(r.cardId)) (reviewsOf.get(r.cardId) ?? reviewsOf.set(r.cardId, []).get(r.cardId)!).push(r);

  const left: MoveResult['left'] = [];
  const movedCards: Card[] = [];
  const movedNotes: Note[] = [];
  await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const crt = Number((await db.first<{ crt: number }>('SELECT crt FROM col'))!.crt);
    const clock: AnkiClock = { crt, dayStartsAtHour: cs.dayStartsAtHour, creationOffset: cs.creationOffset };
    const nowSecs = Math.floor(now.getTime() / 1000);
    const today = ankiDayNumber(nowSecs, clock);
    await db.transaction(async () => {
      for (const { note, cards: noteCards } of candidates) {
        const check = await moveCheck(db, note, noteCards, noteTypes);
        if ('reason' in check) { left.push({ word: wordOf(note), reason: check.reason }); continue; }
        const live = noteCards.filter((c) => !c.retired);
        const deckId = await ankiDeckIdOrCreate(db, note.deck, now);
        const added = await insertAnkiNote(db, { noteType: check.noteType, deckId, fields: note.fields, tags: note.tags, ords: live.map((c) => ordOf(note, c.kind)), now });
        const cidOf = new Map(added.cards.map((c) => [c.ord, c.id]));
        for (const card of live) {
          const cid = cidOf.get(ordOf(note, card.kind))!;
          const home = cardHomeDeck(card, note.deck);
          const p: DeckParams | undefined = paramsForDeck(home, params);
          if (home !== note.deck) await db.run('UPDATE cards SET did = ? WHERE id = ?', await ankiDeckIdOrCreate(db, home, now), cid);
          const current = (await db.first<AnkiCardRow>(CARD_ROW_SQL, cid))!;
          // Placed as when it was last answered: a learning step from that day keeps its exact time.
          const update = cardUpdate(card, current, {
            clock, now: card.sched.lastReview ? new Date(card.sched.lastReview) : now, desiredRetention: p?.desiredRetention,
            steps: { learn: (p?.learnSteps ?? DEFAULT_LEARN_STEPS).length, relearn: (p?.relearnSteps ?? DEFAULT_RELEARN_STEPS).length },
            weights: p?.weights ?? [],
          });
          await db.run(CARD_UPDATE_SQL, ...cardUpdateParams({ ...update, mod: nowSecs }, cid));
          if (card.flag) await db.run('UPDATE cards SET flags = ? WHERE id = ?', card.flag & 7, cid);

          const history = historyRevlog(card, reviewsOf.get(card.id) ?? [], clock);
          let delta = { new: 0, review: 0, ms: 0 };
          for (const h of history) {
            // At the answer's own time, moved on only past an id already taken, so it stays on its day.
            let id = h.at;
            while (await db.first('SELECT 1 FROM revlog WHERE id = ?', id)) id++;
            const { at, ...row } = h;
            await db.run(REVLOG_INSERT_SQL, ...revlogParams({ ...row, id, cid }));
            if (row.ease > 0 && ankiDayNumber(Math.floor(at / 1000), clock) === today) {
              const d = studiedDelta({ type: row.type === 0 && row.lastIvl === 0 ? 0 : 2, queue: row.type === 0 && row.lastIvl === 0 ? 0 : row.type === 1 ? 2 : 1, due: 0 }, 0);
              delta = { new: delta.new + d.new, review: delta.review + d.review, ms: 0 };
            }
          }
          if (delta.new || delta.review) {
            const did = (await db.first<{ did: number }>('SELECT did FROM cards WHERE id = ?', cid))!.did;
            for (const d of deckAndParents(await db.all<DeckStatsRow>(DECKS_SQL), Number(did))) {
              await db.run(DECK_STATS_UPDATE_SQL, withStudied(d.common, today, delta), nowSecs, -1, d.id);
            }
          }
          movedCards.push({ ...card, ankiId: String(cid) });
        }
        movedNotes.push(note);
      }
      await db.run(COL_MODIFIED_SQL, now.getTime());
    });
  }));
  if (movedNotes.length) {
    // Each note's live cards only: the upsert un-retires a card it's given, and retires (again) one it isn't.
    await store.upsertNotesAndCards(movedNotes, movedCards);
    await store.lockAnki(refresh);
  }
  return { moved: movedNotes.length, left };
}
