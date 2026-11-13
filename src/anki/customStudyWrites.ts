import { decodeMessage, MessageWriter, withField } from './protobuf';
import { hasUnicase, type SyncDb } from './sync/collectionSync';
import { deckRow } from './sync/deckRows';
import { filteredPlan, type CustomStudy, type FilteredPlan } from '../core/customStudy';
import { Refusal } from '../core/failure';
import { COL_MODIFIED_SQL, queueForType } from './writeback';

/**
 * Custom Study written into the kept Anki collection the way Anki writes it (rslib's
 * scheduler/filtered, decks), so sync and Send to Anki carry it back: every changed row is marked
 * unsent (usn -1) and the collection stamped modified. Runs on a connection of its own to the
 * kept collection (`withSyncConnection`), inside `lockAnki`.
 *
 * Anki's own cards are chosen here in SQL rather than by running Anki's search, so each option's
 * SQL has to mean what its search text in `filteredPlan` means. Learning and relearning cards are
 * never moved: Anki keeps their due as a timestamp or a day, which a filtered deck's position
 * would overwrite, so a card still on a learning step stays where it is. (Not run against Anki
 * itself in CI; see tests/anki/customStudyWrites.test.ts for what is checked.)
 */

const KIND = { normal: 1, filtered: 2 };
const NORMAL = { reviewLimitToday: 8, newLimitToday: 9 };
const DAY_LIMIT = { limit: 1, today: 2 };
const DAY_SECS = 86400;
/** Anki numbers the cards of a filtered deck from here, so they sort before anything's own due. */
const POSITION_BASE = -100_000;

const humanName = (native: string) => native.split('\x1f').join('::');

interface DeckRowRaw { id: number; name: string; mtime_secs: number; usn: number; common: Uint8Array; kind: Uint8Array }

const allDecks = (db: SyncDb) =>
  db.all<DeckRowRaw>('SELECT id, name, mtime_secs, usn, common, kind FROM decks NOT INDEXED');

const isFiltered = (kind: Uint8Array) => decodeMessage(kind).has(KIND.filtered);

/** Why a custom study can't run, with what to do, to show as it is. */
export class CustomStudyRefused extends Refusal {}

/** A deck's own today-only limits, as Anki's custom study sets them: the new total for the day, from its day number. */
export interface DayLimits { newLimit?: number; reviewLimit?: number }

/**
 * Sets a deck's limits for the Anki day `today` (`Deck.Normal.new_limit_today` / `review_limit_today`),
 * changing nothing else in the deck: its bytes are edited in place, so settings Franki doesn't read
 * (desired retention to the last digit, extras) survive. False when Anki has no such normal deck.
 */
export async function setAnkiDayLimits(db: SyncDb, deck: string, limits: DayLimits, today: number, now: Date): Promise<boolean> {
  const row = (await allDecks(db)).find((r) => humanName(r.name) === deck);
  if (!row || isFiltered(row.kind)) return false;
  const field = decodeMessage(row.kind).get(KIND.normal)?.[0];
  let bytes: Uint8Array = field?.wire === 2 ? field.value : new Uint8Array(0);
  const dayLimit = (limit: number) => new MessageWriter().uint(DAY_LIMIT.limit, limit).uint(DAY_LIMIT.today, today).finish();
  if (limits.newLimit !== undefined) bytes = withField(bytes, NORMAL.newLimitToday, dayLimit(limits.newLimit));
  if (limits.reviewLimit !== undefined) bytes = withField(bytes, NORMAL.reviewLimitToday, dayLimit(limits.reviewLimit));
  const kind = new MessageWriter().bytes(KIND.normal, bytes).finish();
  await db.transaction(async () => {
    await db.run('UPDATE decks SET kind = ?, mtime_secs = ?, usn = -1 WHERE id = ?', kind, Math.floor(now.getTime() / 1000), row.id);
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return true;
}

/** Whether Anki has the deck, and it isn't a filtered one (custom study studies a normal deck). */
export async function ankiNormalDeckExists(db: SyncDb, deck: string): Promise<boolean> {
  const row = (await allDecks(db)).find((r) => humanName(r.name) === deck);
  return !!row && !isFiltered(row.kind);
}

/** A LIKE pattern's own characters, escaped (the query says ESCAPE '\'). */
const likeEscaped = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

export interface SelectionContext {
  /** Anki's day number now (`ankiToday`). */
  today: number;
  /** When the study day ends, unix seconds: Anki's `rated:` and `added:` count whole days back from it. */
  dayEndSecs: number;
}

/**
 * The ids of the cards a custom study takes from `deckIds`, in the order Anki would put them in,
 * at most the plan's limit. Cards that are suspended, buried, in another filtered deck or on a
 * learning step are never taken.
 */
export async function selectCards(db: SyncDb, deckIds: number[], study: CustomStudy, plan: FilteredPlan, ctx: SelectionContext): Promise<number[]> {
  const where = [`c.did IN (${deckIds.map(() => '?').join(', ')})`, 'c.odid = 0', 'c.queue IN (0, 2)'];
  const params: (string | number)[] = [...deckIds];
  const sinceMs = (days: number) => (ctx.dayEndSecs - days * DAY_SECS) * 1000;
  switch (study.kind) {
    case 'forgotten':
      where.push('c.id IN (SELECT cid FROM revlog WHERE ease = 1 AND id > ?)');
      params.push(sinceMs(study.days));
      break;
    case 'ahead':
      where.push('c.queue = 2', 'c.due <= ?');
      params.push(ctx.today + study.days);
      break;
    case 'previewNew':
      where.push('c.type = 0', 'c.id > ?');
      params.push(sinceMs(study.days));
      break;
    case 'cram':
      if (study.select === 'new') where.push('c.type = 0');
      else if (study.select === 'due') { where.push('c.queue = 2', 'c.due <= ?'); params.push(ctx.today); }
      else if (study.select === 'review') where.push('c.queue = 2');
      // A tag also matches the tags under it ("verb" and "verb::irregular"), whatever its case.
      if (study.include.length) {
        where.push(`(${study.include.map(() => "(n.tags LIKE ? ESCAPE '\\' OR n.tags LIKE ? ESCAPE '\\')").join(' OR ')})`);
        for (const t of study.include) params.push(`% ${likeEscaped(t)} %`, `% ${likeEscaped(t)}::%`);
      }
      for (const t of study.exclude) {
        where.push("n.tags NOT LIKE ? ESCAPE '\\'", "n.tags NOT LIKE ? ESCAPE '\\'");
        params.push(`% ${likeEscaped(t)} %`, `% ${likeEscaped(t)}::%`);
      }
      break;
    default:
      throw new Error(`${study.kind} puts no cards in a filtered deck.`);
  }
  const order = plan.order === 1 ? 'RANDOM()' : plan.order === 5 ? 'n.id, c.ord' : 'c.due, c.ord';
  const rows = await db.all<{ id: number }>(
    `SELECT c.id FROM cards c JOIN notes n ON n.id = c.nid WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    ...params, plan.limit,
  );
  return rows.map((r) => r.id);
}

/**
 * Puts the cards of a filtered deck back in their own decks, as Anki's Empty does
 * (`remove_from_filtered_deck_restoring_queue`): the home deck and due are restored and every card
 * goes back to the queue its type puts it in, which matters for a deck Anki built without
 * rescheduling: it puts new cards there in the review queue. A card suspended or buried since it
 * was moved keeps that.
 */
export async function emptyFilteredDeck(db: SyncDb, deckId: number, now: Date): Promise<number> {
  const cards = await db.all<{ id: number; type: number; queue: number; due: number; odue: number; odid: number }>(
    'SELECT id, type, queue, due, odue, odid FROM cards WHERE did = ? AND odid != 0', deckId,
  );
  const nowSecs = Math.floor(now.getTime() / 1000);
  for (const c of cards) {
    const due = c.odue !== 0 ? c.odue : c.due;
    const queue = c.queue >= 0 ? queueForType(c.type, due) : c.queue;
    await db.run('UPDATE cards SET did = ?, odid = 0, odue = 0, due = ?, queue = ?, mod = ?, usn = -1 WHERE id = ?', c.odid, due, queue, nowSecs, c.id);
  }
  return cards.length;
}

/** The result: the deck to study, and how many cards went into it. */
export interface CustomStudyDeck { deck: string; moved: number; ankiIds: string[] }

/**
 * Builds "Custom Study Session" from `deck` (and its subdecks) for a custom study that uses cards,
 * as Anki's custom study does: an existing session deck is emptied first and reused, a missing one
 * is created, and the cards matching are moved in, in order. Nothing changes when no card matches.
 */
export async function buildCustomStudyDeck(
  db: SyncDb,
  r: { deck: string; sessionDeck: string; study: CustomStudy; ctx: SelectionContext; now: Date },
): Promise<CustomStudyDeck> {
  const plan = filteredPlan(r.study, r.deck);
  if (!plan) throw new Error(`${r.study.kind} puts no cards in a filtered deck.`);
  const nowSecs = Math.floor(r.now.getTime() / 1000);
  let result!: CustomStudyDeck;
  await db.transaction(async () => {
    const decks = await allDecks(db);
    const source = decks.find((d) => humanName(d.name) === r.deck);
    if (!source) throw new CustomStudyRefused(`The Anki collection has no deck called "${r.deck}".`);
    const existing = decks.find((d) => humanName(d.name) === r.sessionDeck);
    if (existing && !isFiltered(existing.kind)) {
      throw new CustomStudyRefused(`The Anki collection has a deck called "${r.sessionDeck}" that isn't a filtered deck. Rename it in Anki, then try again.`);
    }
    // A new deck goes into a table indexed by Anki's collation, which a build made before modules/anki-unicase lacks.
    if (!existing && !(await hasUnicase(db))) {
      throw new CustomStudyRefused(`This build of Franki can't add a deck to your Anki collection yet. Rebuild the app, or make a deck called "${r.sessionDeck}" in Anki (a filtered deck), then try again.`);
    }
    if (existing) await emptyFilteredDeck(db, existing.id, r.now);

    const prefix = `${source.name}\x1f`;
    const ids = decks.filter((d) => d.id !== existing?.id && !isFiltered(d.kind) && (d.name === source.name || d.name.startsWith(prefix))).map((d) => d.id);
    const picked = await selectCards(db, ids, r.study, plan, r.ctx);
    if (!picked.length) throw new CustomStudyRefused('No cards match. Choose different settings, or study the deck as it is.');

    const search = plan.search;
    const row = deckRow({
      id: existing?.id ?? Math.max(r.now.getTime(), ...decks.map((d) => d.id + 1)), name: r.sessionDeck, mod: nowSecs, usn: -1,
      lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: true, browserCollapsed: true, desc: '', dyn: 1,
      resched: plan.reschedule, terms: [[search, plan.limit, plan.order]], separate: true, delays: null,
      previewDelay: 0, previewAgainSecs: 60, previewHardSecs: 600, previewGoodSecs: 0,
    });
    if (existing) {
      await db.run('UPDATE decks SET kind = ?, mtime_secs = ?, usn = -1 WHERE id = ?', row.kind, nowSecs, row.id);
    } else {
      await db.run('INSERT INTO decks (id, name, mtime_secs, usn, common, kind) VALUES (?, ?, ?, -1, ?, ?)', row.id, row.name, nowSecs, row.common, row.kind);
    }

    let position = POSITION_BASE;
    for (const cid of picked) {
      // A card's own due is kept in odue; the deck's position stands in for it (a card due at 0 or
      // before keeps its due, as in Anki). Without rescheduling every card goes in the preview queue.
      await db.run(
        `UPDATE cards SET odid = did, odue = due, did = ?, due = CASE WHEN due > 0 THEN ? ELSE due END, queue = CASE WHEN ? THEN queue ELSE 4 END, mod = ?, usn = -1 WHERE id = ?`,
        row.id, position++, plan.reschedule ? 1 : 0, nowSecs, cid,
      );
    }
    await db.run(COL_MODIFIED_SQL, r.now.getTime());
    result = { deck: r.sessionDeck, moved: picked.length, ankiIds: picked.map(String) };
  });
  return result;
}
