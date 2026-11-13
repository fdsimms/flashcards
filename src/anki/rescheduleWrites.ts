import { decodeMessage, float, message, uint, utf8Decode, utf8Encode } from './protobuf';
import type { SyncDb } from './sync/collectionSync';
import { parseJson, stringifyJson } from './sync/json';
import { COL_MODIFIED_SQL, REVLOG_INSERT_SQL, nextRevlogId, revlogParams, type AnkiRevlogRow } from './writeback';

/**
 * Anki's Forget and Set Due Date, written into the kept collection as Anki writes them, so sync
 * and Send to Anki carry them: rslib's scheduler/new.rs (`schedule_as_new`,
 * `reschedule_cards_as_new`), scheduler/reviews.rs (`set_due_date`) and revlog/mod.rs
 * (`log_scheduled_review`). Each card's row changes, one "Manual" review log row (type 4) is
 * added for it, both with usn -1, and the collection is stamped modified. Checked against what
 * Anki 26.09 writes in tests/anki/rescheduleWrites.test.ts.
 */

/** The columns of an Anki `cards` row Forget and Set Due Date read and write. */
export interface RescheduleRow {
  did: number;
  odid: number;
  odue: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  data: string;
}

/** Anki's review log kind for a card scheduled by hand. */
const REVLOG_MANUAL = 4;
const DAY_SECS = 86400;
/** Anki's due values from here up are unix timestamps (an intraday learning step), below are day numbers. */
const TIMESTAMP_DUE = 1_000_000_000;

type CardData = Record<string, unknown>;

function readData(data: string): CardData {
  try {
    const parsed = data ? JSON.parse(data) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
const writeData = (d: CardData) => JSON.stringify(d);

/** The card's FSRS memory state (`s`, `d` in its data), if it has one. */
function memoryOf(d: CardData): { stability: number; difficulty: number } | undefined {
  return typeof d.s === 'number' && typeof d.d === 'number' ? { stability: d.s, difficulty: d.d } : undefined;
}

/** Anki's `last_position`: a new card's due (odue in a filtered deck), else the position it had when new (`pos`). */
function lastPosition(row: RescheduleRow, d: CardData): number | undefined {
  if (row.type === 0) return row.odid ? row.odue : row.due;
  return typeof d.pos === 'number' ? d.pos : undefined;
}

/** Anki's `remove_from_filtered_deck_before_reschedule`: home again, its filtered due dropped. */
function goHome(row: RescheduleRow): RescheduleRow {
  return row.odid ? { ...row, did: row.odid, odid: 0, odue: 0 } : row;
}

/**
 * The row after Forget (`schedule_as_new`), and whether it took `position` (it didn't when it went
 * back to the position it had before).
 */
export function forgetRow(
  row: RescheduleRow,
  opts: { position: number; restorePosition: boolean; resetCounts: boolean },
): { row: RescheduleRow; usedPosition: boolean } {
  const d = readData(row.data);
  const last = opts.restorePosition ? lastPosition(row, d) : undefined;
  const home = goHome(row);
  // memory_state and original_position become None; the rest of the data (dr, lrt, custom) stays.
  delete d.s;
  delete d.d;
  delete d.pos;
  return {
    row: {
      ...home, type: 0, queue: 0, due: last ?? opts.position, ivl: 0, factor: 0,
      reps: opts.resetCounts ? 0 : row.reps, lapses: opts.resetCounts ? 0 : row.lapses, data: writeData(d),
    },
    usedPosition: last === undefined,
  };
}

/**
 * The row after Set Due Date (`Card::set_due_date`): a review due `days` after `today` (Anki's day
 * number). With FSRS the interval is the days since the last answer plus `days` (none for a card
 * never answered); without, it's kept, unless the card wasn't a review or "!" resets it.
 */
export function setDueRow(
  row: RescheduleRow,
  ctx: { today: number; nextDayStartSecs: number; days: number; forceReset: boolean; fsrs: boolean; initialEase: number },
): RescheduleRow {
  const d = readData(row.data);
  const newDue = ctx.today + ctx.days;
  let ivl: number;
  if (ctx.fsrs) {
    if (row.queue === 0 || row.ivl === 0) {
      ivl = 0;
    } else if (typeof d.lrt === 'number') {
      ivl = Math.floor(Math.max(0, ctx.nextDayStartSecs - d.lrt) / DAY_SECS) + ctx.days;
    } else {
      const due = row.odid ? row.odue : row.due;
      const dueDay = due >= TIMESTAMP_DUE ? ctx.today + Math.trunc((due - ctx.nextDayStartSecs) / DAY_SECS) : due;
      ivl = Math.max(0, row.ivl + (newDue - dueDay));
    }
  } else if (ctx.forceReset || (row.type !== 2 && row.type !== 3)) {
    ivl = Math.max(1, ctx.days);
  } else {
    ivl = Math.max(1, row.ivl);
  }
  // schedule_as_review: the position it had as a new card is kept (`pos`), then it goes home.
  const pos = lastPosition(row, d);
  if (pos !== undefined) d.pos = pos;
  else delete d.pos;
  const home = goHome(row);
  return {
    ...home, type: 2, queue: 2, due: newDue, ivl,
    factor: row.factor === 0 ? Math.round(ctx.initialEase * 1000) : row.factor,
    data: writeData(d),
  };
}

/** The "Manual" review log row Anki adds for a card scheduled by hand (`log_scheduled_review`). */
export function manualRevlog(after: RescheduleRow, originalIvl: number, id: number, cid: number): AnkiRevlogRow {
  const memory = memoryOf(readData(after.data));
  // FSRS difficulty shifted to 0.1-1.1, times 1000, cut to a whole number (Rust's `as u16`).
  const factor = memory ? Math.trunc(Math.fround((Math.fround(memory.difficulty) - 1) / 9 + 0.1) * 1000) : after.factor;
  return { id, cid, usn: -1, ease: 0, ivl: after.ivl, lastIvl: originalIvl, factor, time: 0, type: REVLOG_MANUAL };
}

const ROW_SQL = 'SELECT did, odid, odue, type, queue, due, ivl, factor, reps, lapses, data FROM cards WHERE id = ?';
const UPDATE_SQL =
  'UPDATE cards SET did = ?, odid = ?, odue = ?, type = ?, queue = ?, due = ?, ivl = ?, factor = ?, reps = ?, lapses = ?, data = ?, mod = ?, usn = -1 WHERE id = ?';

async function readConfig(db: SyncDb, key: string): Promise<unknown> {
  const row = await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', key);
  if (!row) return undefined;
  try { return parseJson(utf8Decode(row.val)); } catch { return undefined; }
}

async function latestRevlogId(db: SyncDb): Promise<number | null> {
  return (await db.first<{ m: number | null }>('SELECT max(id) AS m FROM revlog'))?.m ?? null;
}

/**
 * The changed cards' rows as they are now, by Anki card id, to read back into Franki.
 * `lastAnsweredId`: the card's latest real answer in the review log, or null. Anki's FSRS takes
 * that as the last review, skipping Manual rows like the one added for the change (ease 0).
 */
export type RescheduledRow = RescheduleRow & { mod: number; lastAnsweredId: number | null };
export type RescheduledRows = Map<number, RescheduledRow>;

async function rewrite(
  db: SyncDb, cids: number[], now: Date,
  change: (row: RescheduleRow, cid: number) => Promise<RescheduleRow> | RescheduleRow,
  after?: () => Promise<void>,
): Promise<RescheduledRows> {
  const out: RescheduledRows = new Map();
  const nowSecs = Math.floor(now.getTime() / 1000);
  await db.transaction(async () => {
    let revlogId = await latestRevlogId(db);
    for (const cid of cids) {
      const row = await db.first<RescheduleRow>(ROW_SQL, cid);
      if (!row) continue;
      const answered = await db.first<{ m: number | null }>('SELECT max(id) AS m FROM revlog WHERE cid = ? AND ease > 0', cid);
      const next = await change({ ...row, data: row.data ?? '' }, cid);
      revlogId = nextRevlogId(now.getTime(), revlogId);
      await db.run(REVLOG_INSERT_SQL, ...revlogParams(manualRevlog(next, row.ivl, revlogId, cid)));
      await db.run(UPDATE_SQL, next.did, next.odid, next.odue, next.type, next.queue, next.due, next.ivl, next.factor, next.reps, next.lapses, next.data, nowSecs, cid);
      out.set(cid, { ...next, mod: nowSecs, lastAnsweredId: answered?.m ?? null });
    }
    if (after) await after();
    await db.run(COL_MODIFIED_SQL, now.getTime());
  });
  return out;
}

/** Forgets cards in the kept collection (Anki's Forget, logged). Positions come from `nextPos`, as Anki's do. */
export async function forgetAnkiCards(
  db: SyncDb, cids: number[], opts: { restorePosition: boolean; resetCounts: boolean }, now: Date,
): Promise<RescheduledRows> {
  let position = Number(await readConfig(db, 'nextPos')) || 1;
  const nowSecs = Math.floor(now.getTime() / 1000);
  return rewrite(db, cids, now, (row) => {
    const r = forgetRow(row, { ...opts, position });
    if (r.usedPosition) position += 1;
    return r.row;
  }, () => db.run("INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES ('nextPos', -1, ?, ?)", nowSecs, utf8Encode(stringifyJson(position))));
}

const DECK_KIND_NORMAL = 1; // Deck.kind: normal
const NORMAL_CONFIG_ID = 1; // Deck.Normal.config_id
const CONFIG_INITIAL_EASE = 11; // DeckConfig.Config.initial_ease
const DEFAULT_INITIAL_EASE = 2.5;

/** The starting ease of a card's home deck's preset, as Anki's set_due_date looks it up. */
async function initialEase(db: SyncDb, did: number, cache: Map<number, number>): Promise<number> {
  const known = cache.get(did);
  if (known !== undefined) return known;
  let ease = DEFAULT_INITIAL_EASE;
  const deck = await db.first<{ kind: Uint8Array }>('SELECT kind FROM decks WHERE id = ?', did);
  const normal = deck ? message(decodeMessage(deck.kind), DECK_KIND_NORMAL) : undefined;
  const confId = normal ? uint(normal, NORMAL_CONFIG_ID) ?? 1 : undefined;
  if (confId !== undefined) {
    const conf = await db.first<{ config: Uint8Array }>('SELECT config FROM deck_config WHERE id = ?', confId);
    const value = conf ? float(decodeMessage(conf.config), CONFIG_INITIAL_EASE) : undefined;
    if (value) ease = value;
  }
  cache.set(did, ease);
  return ease;
}

/**
 * Sets cards' due dates in the kept collection (Anki's Set Due Date, logged). `days` is picked per
 * card (a range picks afresh for each); `today` is Anki's day number and `nextDayStartSecs` when
 * the next study day starts.
 */
export async function setAnkiDueDates(
  db: SyncDb, cids: number[],
  ctx: { today: number; nextDayStartSecs: number; days: () => number; forceReset: boolean },
  now: Date,
): Promise<RescheduledRows> {
  const fsrs = (await readConfig(db, 'fsrs')) === true;
  const eases = new Map<number, number>();
  return rewrite(db, cids, now, async (row) => setDueRow(row, {
    today: ctx.today, nextDayStartSecs: ctx.nextDayStartSecs, days: ctx.days(), forceReset: ctx.forceReset, fsrs,
    initialEase: await initialEase(db, row.odid || row.did, eases),
  }));
}
