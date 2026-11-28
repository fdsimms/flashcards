import { fuzzSeed } from '../core/ankiFuzz';
import { answersSinceReset, lastAnswerOf, rescheduledInterval, type RevlogEntryLite } from '../core/retentionReschedule';
import { fsrsDecay } from '../core/scheduler';
import { deckName, readDeckConfig, readDeckKind } from './collection';
import { utf8Decode } from './protobuf';
import { manualRevlog, REVLOG_RESCHEDULED } from './rescheduleWrites';
import type { SyncDb } from './sync/collectionSync';
import { parseJson } from './sync/json';
import { COL_MODIFIED_SQL, REVLOG_INSERT_SQL, nextRevlogId, revlogParams } from './writeback';

/**
 * A preset's new desired retention reaching its cards in the kept collection, as Anki's deck
 * options write it (rslib's deckconfig/update.rs, then scheduler/fsrs/memory_state.rs): every
 * studied card of a deck whose retention changed has the new retention written into its data
 * (`dr`, with the weights' `decay`), and with "Reschedule cards on change" each review card that
 * isn't suspended and has been answered gets a new interval and due date (src/core/
 * retentionReschedule.ts) and one "Rescheduled" review log row (type 5). Rows change with usn -1
 * and the collection is stamped modified, so a sync sends them. Checked against what Anki 26.09
 * writes in tests/anki/retentionWrites.test.ts (make-retention-vectors.py).
 *
 * A deck's retention changes with its preset's only when the deck has no retention of its own
 * (Anki's "This deck"), so those decks and their cards are left as they are.
 */

const DAY_SECS = 86400;

interface Target { id: number; did: number; odid: number; odue: number; type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number; data: string }

/** The decks a change to `presetId`'s retention reaches: normal decks on it with no retention of their own. */
export async function retentionDecks(db: SyncDb): Promise<(presetId: number) => { id: number; name: string }[]> {
  const rows = await db.all<{ id: number; name: string; kind: Uint8Array }>('SELECT id, name, kind FROM decks NOT INDEXED');
  const decks = rows.map((r) => ({ id: Number(r.id), name: deckName(r.name), kind: readDeckKind(r.kind) }));
  return (presetId) => decks.filter((d) => d.kind?.configId === presetId && d.kind.desiredRetention === undefined).map(({ id, name }) => ({ id, name }));
}

/** The studied cards of those decks, at home or in a filtered deck (Anki's `did:` search reads both). */
async function targetCards(db: SyncDb, deckIds: number[]): Promise<Target[]> {
  if (!deckIds.length) return [];
  const ids = deckIds.join(',');
  return db.all<Target>(
    `SELECT id, did, odid, odue, type, queue, due, ivl, factor, reps, lapses, data FROM cards WHERE type != 0 AND (did IN (${ids}) OR (odid != 0 AND odid IN (${ids}))) ORDER BY id`,
  );
}

async function revlogOf(db: SyncDb, cid: number): Promise<RevlogEntryLite[]> {
  return db.all<RevlogEntryLite>('SELECT id, ease, type, factor, lastIvl FROM revlog WHERE cid = ? ORDER BY id', cid);
}

/** Whether rescheduling moves this card: a review, not suspended, with an answer that counts. */
const reschedules = (c: Target, revlog: RevlogEntryLite[]) => c.type === 2 && c.queue !== -1 && lastAnswerOf(revlog) !== undefined;

/** How many cards rescheduling for a change to `presetId`'s retention would move: what the screen asks about. */
export async function countRetentionReschedule(db: SyncDb, presetId: number): Promise<number> {
  const decks = (await retentionDecks(db))(presetId);
  let n = 0;
  for (const c of await targetCards(db, decks.map((d) => d.id))) if (reschedules(c, await revlogOf(db, c.id))) n++;
  return n;
}

function readData(data: string): Record<string, unknown> {
  try {
    const parsed = data ? JSON.parse(data) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function configValue(db: SyncDb, key: string): Promise<unknown> {
  const row = await db.first<{ val: Uint8Array }>('SELECT val FROM config WHERE KEY = ?', key);
  if (!row) return undefined;
  try { return parseJson(utf8Decode(row.val)); } catch { return undefined; }
}

/** The load balancer's counts for one preset, as the Rescheduler builds them before any card moves. */
async function presetLoad(db: SyncDb, presetId: number, today: number, nextDayStartSecs: number) {
  const decks = await db.all<{ id: number; kind: Uint8Array }>('SELECT id, kind FROM decks NOT INDEXED');
  const onPreset = new Set(decks.filter((d) => readDeckKind(d.kind)?.configId === presetId).map((d) => Number(d.id)));
  const dueByDay = new Map<number, number>();
  // rslib's storage/card/deck_due_counts.sql: review cards, not suspended, at home.
  const due = await db.all<{ did: number; due: number; n: number }>(
    'SELECT CASE WHEN odid = 0 THEN did ELSE odid END AS did, CASE WHEN odid = 0 THEN due ELSE odue END AS due, COUNT() AS n FROM cards WHERE type = 2 AND queue != -1 GROUP BY 1, 2',
  );
  let todayLoad = 0;
  for (const r of due) {
    if (!onPreset.has(Number(r.did))) continue;
    dueByDay.set(r.due, (dueByDay.get(r.due) ?? 0) + r.n);
    if (r.due <= today) todayLoad += r.n;
  }
  // rslib's storage/revlog/studied_today_by_deck.sql: cards answered today, by home deck.
  const studied = await db.all<{ did: number; n: number }>(
    `SELECT CASE WHEN c.odid = 0 THEN c.did ELSE c.odid END AS did, COUNT(DISTINCT r.cid) AS n FROM revlog AS r JOIN cards AS c ON r.cid = c.id
     WHERE r.id > ? AND r.ease > 0 AND (r.type < 3 OR r.factor != 0) GROUP BY 1`,
    (nextDayStartSecs - DAY_SECS) * 1000,
  );
  for (const r of studied) if (onPreset.has(Number(r.did))) todayLoad += r.n;
  return { dueByDay, todayLoad };
}

export interface RetentionChange {
  presetId: number;
  /** The preset's new desired retention. */
  retention: number;
  /** Move review cards' due dates to the new retention ("Reschedule cards on change"). */
  reschedule: boolean;
  /** Anki's day number today, and when the next study day starts (unix seconds). */
  today: number;
  nextDayStartSecs: number;
  /** The weekday (Monday 0) of Anki day `day`, for easy days; by default this device's, as Anki reads it. */
  weekdayOf?: (day: number) => number;
}

export interface RetentionResult {
  /** The decks the change reached, by name. */
  decks: string[];
  /** Cards given a new due date. */
  rescheduled: number;
  /** Cards written at all (the new retention in their data, a new date or both). */
  changed: number;
}

/**
 * Writes a retention change into the cards of the decks it reaches, and says which decks those
 * were and how many cards it changed and rescheduled. It opens no transaction of its own: call it inside the one that
 * saves the preset (`setAnkiPresetOptions`'s `onRetentionChange`), after the preset is written, since it reads the
 * preset's weights, maximum interval and easy days from there.
 */
export async function applyRetentionChange(db: SyncDb, change: RetentionChange, now: Date): Promise<RetentionResult> {
  const conf = await db.first<{ config: Uint8Array }>('SELECT config FROM deck_config WHERE id = ?', change.presetId);
  if (!conf) return { decks: [], rescheduled: 0, changed: 0 };
  const preset = readDeckConfig(conf.config);
  const maxInterval = preset.maxInterval ?? 36500;
  const decks = (await retentionDecks(db))(change.presetId);
  const cards = await targetCards(db, decks.map((d) => d.id));
  const dr = Number(change.retention.toFixed(2));
  const decay = Number(fsrsDecay(preset.weights).toFixed(3));
  const nowSecs = Math.floor(now.getTime() / 1000);

  const balanced = change.reschedule && (await configValue(db, 'loadBalancerEnabled')) !== false;
  const load = balanced ? await presetLoad(db, change.presetId, change.today, change.nextDayStartSecs) : undefined;
  // day-ms-ok: Anki adds whole days of seconds to the next day's start here too.
  const weekdayOf = change.weekdayOf ?? ((day: number) => (new Date((change.nextDayStartSecs + (day - change.today - 1) * DAY_SECS) * 1000).getDay() + 6) % 7);

  // Anki works through the cards by how many answers their memory state comes from, fewest first
  // (`update_memory_state_for_cards_with_items`), which decides the load balancer's counts as it goes.
  const withLog = await Promise.all(cards.map(async (c) => ({ card: c, revlog: await revlogOf(db, c.id) })));
  const ordered = withLog.map((x, i) => ({ ...x, i, n: answersSinceReset(x.revlog) })).sort((a, b) => a.n - b.n || a.i - b.i);

  let revlogId = (await db.first<{ m: number | null }>('SELECT max(id) AS m FROM revlog'))?.m ?? null;
  let rescheduled = 0;
  let changed = 0;
  for (const { card, revlog } of ordered) {
    const data = readData(card.data);
    // Only a card with a memory state is given the retention (Anki's cards with no answer to work one out from keep none).
    if (typeof data.s !== 'number' || typeof data.d !== 'number') continue;
    const before = JSON.stringify(data);
    data.dr = dr;
    data.decay = decay;
    let next: Target = { ...card, data: JSON.stringify(data) };
    const last = lastAnswerOf(revlog);
    if (change.reschedule && last && reschedules(card, revlog)) {
      const elapsed = Math.floor(Math.max(0, change.nextDayStartSecs - last.at) / DAY_SECS);
      const ivl = rescheduledInterval({
        stability: data.s, desiredRetention: change.retention, weights: preset.weights, maxInterval,
        previousInterval: last.previousInterval, daysElapsed: elapsed,
        seed: fuzzSeed(String(card.id), Math.max(0, card.reps - 1)),
        balance: load ? { today: change.today, dueByDay: load.dueByDay, todayLoad: load.todayLoad, easyDays: preset.easyDays, weekdayOf } : undefined,
      });
      const newDue = change.today - elapsed + ivl;
      const dueBefore = card.odue !== 0 ? card.odue : card.due;
      if (load) {
        const was = load.dueByDay.get(dueBefore);
        if (was !== undefined) load.dueByDay.set(dueBefore, was - 1);
        load.dueByDay.set(newDue, (load.dueByDay.get(newDue) ?? 0) + 1);
        if (dueBefore <= change.today && newDue > change.today) load.todayLoad -= 1;
        if (dueBefore > change.today && newDue <= change.today) load.todayLoad += 1;
      }
      next = card.odue !== 0 ? { ...next, ivl, odue: newDue } : { ...next, ivl, due: newDue };
      revlogId = nextRevlogId(now.getTime(), revlogId);
      await db.run(REVLOG_INSERT_SQL, ...revlogParams(manualRevlog(next, card.ivl, revlogId, card.id, REVLOG_RESCHEDULED)));
      rescheduled++;
    } else if (next.data === before) {
      continue;
    }
    await db.run('UPDATE cards SET ivl = ?, due = ?, odue = ?, data = ?, mod = ?, usn = -1 WHERE id = ?', next.ivl, next.due, next.odue, next.data, nowSecs, card.id);
    changed++;
  }
  await db.run(COL_MODIFIED_SQL, now.getTime());
  return { decks: decks.map((d) => d.name), rescheduled, changed };
}
