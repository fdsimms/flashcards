import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { forgetAnkiCards, forgetRow, setAnkiDueDates, setDueRow, type RescheduleRow } from '../../src/anki/rescheduleWrites';
import { utf8Decode, utf8Encode } from '../../src/anki/protobuf';
import { parseDueDate, pickDays } from '../../src/core/reschedule';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURES = join(__dirname, '..', 'fixtures', 'anki');
const NOW = new Date(2026, 10, 11, 12);

/** What Anki 26.09 wrote for each case (make-reschedule-vectors.py). */
interface Vector {
  name: string;
  op: 'forget' | 'setDue';
  cids: number[];
  fsrs: boolean;
  restorePosition?: boolean;
  resetCounts?: boolean;
  days?: string;
  today: number;
  nextDayAt: number;
  rows: (RescheduleRow & { id: number })[];
  revlog: Record<string, number>[];
  nextPos: number;
}
const VECTORS: Vector[] = JSON.parse(readFileSync(join(FIXTURES, 'reschedule-vectors.json'), 'utf8'));

async function kept(fsrs: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'reschedule-'));
  copyFileSync(join(FIXTURES, 'collection.anki2'), join(dir, 'collection.anki2'));
  const db = await nodeSyncDb(join(dir, 'collection.anki2'));
  await db.run("INSERT OR REPLACE INTO config (KEY, usn, mtime_secs, val) VALUES ('fsrs', 0, 0, ?)", utf8Encode(String(fsrs)));
  return db;
}

// Card data is compared as JSON, not text: Anki writes 1.0 where JavaScript writes 1, and reads either.
const comparable = (r: any) => ({ ...r, data: JSON.parse(r.data || '{}') });

describe('Forget and Set Due Date in the kept collection, as Anki writes them', () => {
  for (const v of VECTORS) {
    it(v.name, async () => {
      const db = await kept(v.fsrs);
      if (v.op === 'forget') {
        await forgetAnkiCards(db, v.cids, { restorePosition: !!v.restorePosition, resetCounts: !!v.resetCounts }, NOW);
      } else {
        const spec = parseDueDate(v.days!)!;
        await setAnkiDueDates(db, v.cids, { today: v.today, nextDayStartSecs: v.nextDayAt, days: () => pickDays(spec), forceReset: spec.forceReset }, NOW);
      }
      const rows = await db.all<any>(
        `SELECT id, did, odid, odue, type, queue, due, ivl, factor, reps, lapses, data, mod, usn FROM cards WHERE id IN (${v.cids.join(',')}) ORDER BY id`,
      );
      expect(rows.map(({ mod, usn, ...r }) => comparable(r))).toEqual(v.rows.map(comparable));
      expect(rows.every((r) => r.usn === -1 && r.mod === Math.floor(NOW.getTime() / 1000))).toBe(true);
      const revlog = await db.all<any>(`SELECT cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog WHERE type = 4 ORDER BY id`);
      expect(revlog).toEqual(v.revlog);
      const nextPos = await db.first<{ val: Uint8Array }>("SELECT val FROM config WHERE KEY = 'nextPos'");
      expect(Number(utf8Decode(nextPos!.val))).toBe(v.nextPos);
      expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
      db.close();
    });
  }
});

const review: RescheduleRow = { did: 1, odid: 0, odue: 0, type: 2, queue: 2, due: 50, ivl: 10, factor: 2500, reps: 4, lapses: 1, data: '{"pos":3,"s":12,"d":5,"lrt":1000}' };

describe('forgetRow', () => {
  it('takes the next position when the card has none to go back to, and says so', () => {
    const { pos, ...rest } = JSON.parse(review.data);
    const r = forgetRow({ ...review, data: JSON.stringify(rest) }, { position: 40, restorePosition: true, resetCounts: false });
    expect(r).toMatchObject({ usedPosition: true, row: { due: 40, type: 0, queue: 0, reps: 4, lapses: 1 } });
    expect(JSON.parse(r.row.data)).toEqual({ lrt: 1000 });
  });

  it('keeps unreadable card data from stopping it', () => {
    expect(forgetRow({ ...review, data: 'not json' }, { position: 7, restorePosition: true, resetCounts: false }).row.due).toBe(7);
  });
});

describe('setDueRow', () => {
  const ctx = { today: 100, nextDayStartSecs: 1000 + 86400 * 3 + 3600, days: 2, forceReset: false, fsrs: true, initialEase: 2.5 };

  it('without a last review time, moves the interval by as many days as the due date moves', () => {
    const r = setDueRow({ ...review, due: 98, data: '{"s":12,"d":5}' }, ctx);
    expect(r).toMatchObject({ due: 102, ivl: 14 });
  });

  it('with a last review time, counts the days since it from the next day start', () => {
    expect(setDueRow(review, ctx)).toMatchObject({ due: 102, ivl: 5 });
  });

  it("gives a card with no ease the deck preset's starting ease", () => {
    expect(setDueRow({ ...review, type: 0, queue: 0, ivl: 0, factor: 0, data: '{}' }, { ...ctx, initialEase: 2.3 }).factor).toBe(2300);
  });
});
