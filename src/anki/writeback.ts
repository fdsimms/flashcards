import type { RatingValue } from '../core/scheduler';
import type { Card } from '../core/types';

/**
 * Writes Franki's answers into the Anki collection it keeps, the way Anki would have recorded
 * them, so handing the collection back to Anki carries the full history. Two things change per
 * answer, as in Anki: the card's row (`cardUpdate`) and one new review log row (`revlogEntry`).
 * Both are marked unsynced (usn -1), which is also what a sync would send later.
 *
 * Anki's conventions, from rslib/src/card and rslib/src/revlog in ankitects/anki:
 * - type 0 new, 1 learning, 2 review, 3 relearning (the same numbers as ts-fsrs's states).
 * - queue -1 suspended, 0 new, 1 learning due within the day (due = unix seconds), 2 review,
 *   3 learning due on a later day (due = day number).
 * - Day numbers count days since the collection was created (`col.crt`, at the rollover hour).
 * - `data` is JSON: `s` stability, `d` difficulty (1-10), `dr` desired retention, `lrt` last
 *   review (unix seconds). Other keys there are Anki's and are kept.
 * - revlog: `ivl`/`lastIvl` in days when positive, seconds when negative; `factor` holds FSRS
 *   difficulty normalized to 100-1100 (`((d - 1) / 9 + 0.1) * 1000`); `time` is ms taken;
 *   `type` 0 learn, 1 review, 2 relearn.
 */

/** The columns of an Anki `cards` row Franki reads and writes. */
export interface AnkiCardRow {
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
  left: number;
  data: string | null;
}

export interface AnkiCardUpdate extends AnkiCardRow {
  mod: number;
  usn: number;
}

/** What it takes to undo one answer's write: the card's row before it, and the review log row. */
export interface AnkiUndo {
  cid: number;
  row: AnkiCardRow & { mod: number; usn: number };
  revlogId: number;
  /** Siblings the answer buried, with their rows as they were, to restore on undo. */
  buried: { cid: number; row: AnkiCardRow & { mod: number; usn: number } }[];
}

export interface AnkiRevlogRow {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

/** ts-fsrs's default learning and relearning steps (1m 10m, and 10m), which Franki uses. */
const LEARNING_STEPS = 2;
const RELEARNING_STEPS = 1;
/** Anki caps a review's recorded time at a minute by default ("Maximum answer seconds"). */
const MAX_ANSWER_MS = 60_000;
const DAY_SECS = 86400;

const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** The day number a moment falls on, counted from the collection's creation at the rollover hour. */
export function ankiDayNumber(unixSecs: number, crt: number): number {
  return Math.floor((unixSecs - crt) / DAY_SECS);
}

/** Anki's revlog `factor` under FSRS: difficulty (1-10) normalized to 100-1100. */
export function revlogDifficulty(difficulty: number): number {
  return Math.round(((difficulty - 1) / 9 + 0.1) * 1000);
}

/** The card's Anki row after Franki answered it. `current` is the row as it stands. */
export function cardUpdate(
  card: Card,
  current: AnkiCardRow,
  ctx: { crt: number; now: Date; desiredRetention?: number },
): AnkiCardUpdate {
  const s = card.sched;
  const nowSecs = Math.floor(ctx.now.getTime() / 1000);
  const dueSecs = secs(s.due);
  // An answer takes a card out of a filtered deck, home to its own deck, as in Anki.
  const did = current.odid ? current.odid : current.did;

  let queue: number;
  let due: number;
  let ivl = current.ivl;
  let left = 0;
  if (s.state === 0) {
    queue = 0;
    due = current.odid ? current.odue : current.due; // a new card's position stays
  } else if (s.state === 2) {
    queue = 2;
    due = ankiDayNumber(dueSecs, ctx.crt);
    ivl = Math.max(1, s.scheduledDays);
  } else {
    // Learning or relearning: due within the day keeps its exact time; later, a day number.
    const intraday = dueSecs - nowSecs < DAY_SECS;
    queue = intraday ? 1 : 3;
    due = intraday ? dueSecs : ankiDayNumber(dueSecs, ctx.crt);
    left = Math.max(1, (s.state === 1 ? LEARNING_STEPS : RELEARNING_STEPS) - s.learningSteps);
    if (s.state === 1) ivl = 0;
  }
  if (card.suspended) queue = -1;

  let data: Record<string, unknown> = {};
  try { data = current.data ? JSON.parse(current.data) : {}; } catch { /* unreadable: start afresh */ }
  if (s.state !== 0) {
    data.s = Number(s.stability.toFixed(4));
    data.d = Number(s.difficulty.toFixed(3));
    if (ctx.desiredRetention !== undefined) data.dr = ctx.desiredRetention;
    if (s.lastReview) data.lrt = secs(s.lastReview);
  }

  return {
    did, odid: 0, odue: 0,
    type: s.state, queue, due, ivl,
    // A card leaving New gets Anki's starting ease; FSRS doesn't use it, but SM-2 would.
    factor: current.factor || (s.state === 0 ? 0 : 2500),
    reps: s.reps, lapses: s.lapses, left,
    data: Object.keys(data).length ? JSON.stringify(data) : current.data ?? '',
    mod: nowSecs, usn: -1,
  };
}

/** The interval Anki records for a state: days for a review, negative seconds until due otherwise. */
function revlogInterval(card: Card, now: Date): number {
  if (card.sched.state === 2) return Math.max(1, card.sched.scheduledDays);
  if (card.sched.state === 0) return 0;
  return -Math.max(1, secs(card.sched.due) - Math.floor(now.getTime() / 1000));
}

/** The review log row for one answer. `id` must be unique in the table: the answer's time in ms. */
export function revlogEntry(
  before: Card,
  after: Card,
  rating: RatingValue,
  ctx: { id: number; cid: number; previousIvl: number; now: Date; takenMs: number },
): AnkiRevlogRow {
  const type = before.sched.state === 2 ? 1 : before.sched.state === 3 ? 2 : 0;
  const lastIvl = before.sched.state === 2 ? Math.max(1, ctx.previousIvl) : learningStepIvl(before);
  return {
    id: ctx.id,
    cid: ctx.cid,
    usn: -1,
    ease: rating,
    ivl: revlogInterval(after, ctx.now),
    lastIvl,
    factor: revlogDifficulty(after.sched.difficulty),
    time: Math.min(MAX_ANSWER_MS, Math.max(0, Math.round(ctx.takenMs))),
    type,
  };
}

/**
 * The interval Anki records as `lastIvl` for a card answered from a learning or relearning step:
 * that step's length, as negative seconds (rslib's `IntervalKind::InSecs` via
 * `as_revlog_interval`), so a step 10 minutes after the last answer is -600. Only a new card's
 * first answer records 0, which is how a review log tells a new card from a learning step.
 */
function learningStepIvl(before: Card): number {
  const s = before.sched;
  if ((s.state !== 1 && s.state !== 3) || !s.lastReview) return 0;
  return -Math.max(1, Math.round((new Date(s.due).getTime() - new Date(s.lastReview).getTime()) / 1000));
}

/** Reads the columns `cardUpdate` needs. One parameter: the Anki card id. */
export const CARD_ROW_SQL =
  'SELECT did, odid, odue, type, queue, due, ivl, factor, reps, lapses, left, data, mod, usn FROM cards WHERE id = ?';

/** Writes an `AnkiCardUpdate` (`cardUpdateParams`). These columns use no collation, so the kept collection can be written as is. */
export const CARD_UPDATE_SQL =
  'UPDATE cards SET did = ?, odid = ?, odue = ?, type = ?, queue = ?, due = ?, ivl = ?, factor = ?, reps = ?, lapses = ?, ' +
  'left = ?, data = ?, mod = ?, usn = ? WHERE id = ?';

export function cardUpdateParams(u: AnkiCardUpdate, cid: number): (string | number)[] {
  return [u.did, u.odid, u.odue, u.type, u.queue, u.due, u.ivl, u.factor, u.reps, u.lapses, u.left, u.data ?? '', u.mod, u.usn, cid];
}

/** Puts a card's row back as it was (undo): the row read before the answer, and its old mod/usn. */
export function cardRestoreParams(row: AnkiCardRow & { mod: number; usn: number }, cid: number): (string | number)[] {
  return cardUpdateParams({ ...row, mod: row.mod, usn: row.usn }, cid);
}

export const REVLOG_INSERT_SQL =
  'INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

export function revlogParams(r: AnkiRevlogRow): number[] {
  return [r.id, r.cid, r.usn, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type];
}

/**
 * Every write stamps the collection as modified (milliseconds), as Anki does: a sync compares this
 * stamp with the server's to decide whether anything changed, so without it an answer never syncs.
 */
export const COL_MODIFIED_SQL = 'UPDATE col SET mod = ?';

/**
 * Buries a card until the next day as Anki's scheduler does when a sibling is answered: queue -2
 * (buried by the scheduler, which Anki undoes when a new day starts), its modified time in
 * seconds, and usn -1 so a sync sends it. Parameters: the time (unix seconds), the Anki card id.
 */
export const BURY_CARD_SQL = 'UPDATE cards SET queue = -2, mod = ?, usn = -1 WHERE id = ?';

/** The review log id for an answer at `ms`: its time, moved on past any id already taken. */
export function nextRevlogId(ms: number, latestId: number | null): number {
  return latestId !== null && latestId >= ms ? latestId + 1 : ms;
}
