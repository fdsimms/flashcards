import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../../src/anki/collection';
import { readPackage, writePackage } from '../../src/anki/package';
import {
  CARD_ROW_SQL, CARD_UPDATE_SQL, REVLOG_INSERT_SQL, ankiDayNumber, cardUpdate, cardUpdateParams, nextRevlogId,
  previewAgain, previewReturn, revlogDifficulty, revlogEntry, revlogParams, type AnkiCardRow,
} from '../../src/anki/writeback';
import { makeCards } from '../../src/core/cards';
import { review } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { bytesSource, fileSource, memorySink, writeBytes } from '../support/bytes';
import { omniNote } from '../support/fixtures';

const DIR = join(__dirname, '..', 'fixtures', 'anki');
const CRT = Math.floor(new Date(2026, 10, 1, 4).getTime() / 1000);
const row = (over: Partial<AnkiCardRow> = {}): AnkiCardRow => ({
  did: 5, odid: 0, odue: 0, type: 0, queue: 0, due: 12, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, data: '{"pos":12}', ...over,
});

describe('mapping an answer to Anki', () => {
  const now = new Date(2026, 10, 11, 20, 0);
  const [card] = makeCards(omniNote(), now);

  it('normalizes FSRS difficulty the way Anki does in the review log', () => {
    expect(revlogDifficulty(1)).toBe(100);
    expect(revlogDifficulty(10)).toBe(1100);
  });

  it('writes a first answer as learning due within the day, keeping Anki\'s own data keys', () => {
    const after: Card = { ...card, sched: review(card.sched, 3, now).sched };
    const u = cardUpdate(after, row(), { crt: CRT, now, desiredRetention: 0.85 });
    expect(u).toMatchObject({ type: 1, queue: 1, ivl: 0, reps: 1, factor: 2500, usn: -1 });
    expect(u.due).toBe(Math.floor(new Date(after.sched.due).getTime() / 1000));
    expect(u.left).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(u.data!)).toMatchObject({ pos: 12, dr: 0.85 });
    expect(JSON.parse(u.data!).s).toBeGreaterThan(0);
  });

  it("writes a step that crosses into another day as Anki's day-long learning (queue 3), with its steps left", () => {
    const params = { weights: [], desiredRetention: 0.9, maxInterval: 36500, learnSteps: [10, 1440, 4320] };
    // At 20:00, a Good on the first step waits a day: due tomorrow, on step 2 of 3.
    const after: Card = { ...card, sched: review(card.sched, 3, now, params).sched };
    const u = cardUpdate(after, row(), { crt: CRT, now, steps: { learn: 3, relearn: 1 } });
    expect(u).toMatchObject({ type: 1, queue: 3, left: 2 });
    expect(u.due).toBe(ankiDayNumber(Math.floor(now.getTime() / 1000), CRT) + 1);
    // Anki logs a day-long step in days, and a step within the day in negative seconds.
    expect(revlogEntry(card, after, 3, { id: 1, cid: 1, previousIvl: 0, now, takenMs: 0, crt: CRT }).ivl).toBe(1);
    const short: Card = { ...card, sched: review(card.sched, 3, new Date(2026, 10, 11, 9, 0)).sched };
    expect(revlogEntry(card, short, 3, { id: 1, cid: 1, previousIvl: 0, now: new Date(2026, 10, 11, 9, 0), takenMs: 0, crt: CRT }).ivl).toBe(-600);
  });

  it('keeps a card answered in a filtered deck there while it learns, and sends it home as a review', () => {
    const learning: Card = { ...card, sched: review(card.sched, 3, now).sched };
    expect(cardUpdate(learning, row({ did: 99, odid: 5, odue: 40 }), { crt: CRT, now })).toMatchObject({ did: 99, odid: 5, queue: 1 });
    const graduated: Card = { ...card, sched: review(card.sched, 4, now).sched };
    expect(cardUpdate(graduated, row({ did: 99, odid: 5, odue: 40 }), { crt: CRT, now })).toMatchObject({ did: 5, odid: 0, odue: 0, queue: 2 });
  });

  it("keeps a previewed card in its filtered deck, due again after the delay, when it isn't finished", () => {
    const inPreview = row({ did: 99, odid: 5, odue: 812, type: 2, queue: 2, due: -100000, ivl: 30 });
    expect(previewAgain(inPreview, 1794000060, now)).toMatchObject({ did: 99, odid: 5, odue: 812, type: 2, queue: 4, due: 1794000060, ivl: 30, usn: -1 });
  });

  it("sends a previewed card home with its schedule untouched", () => {
    const inPreview = row({ did: 99, odid: 5, odue: 812, type: 2, queue: 2, due: -100000, ivl: 30, reps: 9 });
    expect(previewReturn(inPreview, now)).toMatchObject({ did: 5, odid: 0, odue: 0, type: 2, queue: 2, due: 812, ivl: 30, reps: 9, usn: -1 });
    expect(previewReturn(row({ did: 99, odid: 5, odue: 3, type: 0, queue: 2, due: -100000 }), now)).toMatchObject({ queue: 0, due: 3 });
  });

  it('writes a review as a day number counted from the collection\'s creation', () => {
    const graduated: Card = { ...card, sched: { ...review(card.sched, 4, now).sched } };
    expect(graduated.sched.state).toBe(2);
    const u = cardUpdate(graduated, row(), { crt: CRT, now });
    expect(u.queue).toBe(2);
    expect(u.due).toBe(ankiDayNumber(Math.floor(new Date(graduated.sched.due).getTime() / 1000), CRT));
    expect(u.ivl).toBe(graduated.sched.scheduledDays);
  });

  it('sends a filtered-deck card home and keeps a suspended card suspended', () => {
    const after: Card = { ...card, suspended: true, sched: review(card.sched, 4, now).sched };
    expect(cardUpdate(after, row({ did: 99, odid: 5, odue: 40 }), { crt: CRT, now })).toMatchObject({ did: 5, odid: 0, odue: 0, queue: -1 });
  });

  it('logs the answer with Anki\'s kinds and units', () => {
    const after: Card = { ...card, sched: review(card.sched, 3, now).sched };
    const r = revlogEntry(card, after, 3, { id: 1, cid: 7, previousIvl: 0, now, takenMs: 95_000 });
    expect(r).toMatchObject({ id: 1, cid: 7, usn: -1, ease: 3, type: 0, lastIvl: 0, time: 60_000 });
    expect(r.ivl).toBeLessThan(0); // learning: negative seconds
  });

  it('logs a learning step\'s length as the previous interval, in negative seconds, as Anki does', () => {
    // Anki logged [type 0, lastIvl 0] for a new card's first answer, then [type 0, lastIvl -600]
    // for its next step, ten minutes later.
    const step = review(card.sched, 3, now).sched;
    expect(step.state).toBe(1);
    const learning: Card = { ...card, sched: { ...step, lastReview: now.toISOString(), due: new Date(now.getTime() + 600_000).toISOString() } };
    const later = new Date(now.getTime() + 600_000);
    const after: Card = { ...learning, sched: review(learning.sched, 3, later).sched };
    expect(revlogEntry(learning, after, 3, { id: 2, cid: 7, previousIvl: 0, now: later, takenMs: 3000 })).toMatchObject({ type: 0, lastIvl: -600 });
  });

  it('never reuses a review log id', () => {
    expect(nextRevlogId(1000, null)).toBe(1000);
    expect(nextRevlogId(1000, 1000)).toBe(1001);
    expect(nextRevlogId(1000, 400)).toBe(1000);
  });
});

describe('a round trip through a real Anki package', () => {
  it('imports, answers, writes back, packs, and reads back the same answers', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const work = mkdtempSync(join(tmpdir(), 'rt-'));
    const colPath = join(work, 'collection.anki2');

    // 1. Unpack Anki's own export.
    const col = memorySink();
    const media = new Map<string, ReturnType<typeof memorySink>>();
    const unpacked = await readPackage(fileSource(join(DIR, 'collection.colpkg')), {
      collection: async () => col,
      media: async (i) => { const s = memorySink(); media.set(i, s); return s; },
    });
    writeBytes(colPath, col.bytes());

    // 2. Import it the way the app does.
    const data = buildExport(await readCollectionRows(colPath));
    const imported = importAnkiJson(data, { now: new Date() });
    const reviewCard = imported.cards.find((c) => c.sched.state === 2)!;
    const newCard = imported.cards.find((c) => c.sched.state === 0 && !c.suspended)!;

    // 3. Answer both, writing back into the kept collection.
    const db = new DatabaseSync(colPath);
    const now = new Date();
    let lastId: number | null = null;
    const answers: { cid: number; ease: number }[] = [];
    for (const [before, rating] of [[reviewCard, 3], [newCard, 4]] as const) {
      const after: Card = { ...before, sched: review(before.sched, rating, now).sched };
      const cid = Number(before.ankiId);
      const current = db.prepare(CARD_ROW_SQL).get(cid) as unknown as AnkiCardRow;
      db.prepare(CARD_UPDATE_SQL).run(...cardUpdateParams(cardUpdate(after, current, { crt: data.collectionCreated, now }), cid));
      lastId = nextRevlogId(now.getTime(), lastId);
      db.prepare(REVLOG_INSERT_SQL).run(...revlogParams(revlogEntry(before, after, rating, { id: lastId, cid, previousIvl: current.ivl, now, takenMs: 4200 })));
      answers.push({ cid, ease: rating });
    }
    db.close();

    // 4. Pack it as a package, with the media, the way "Send to Anki" does.
    const out = memorySink();
    const colBytes = new Uint8Array(require('node:fs').readFileSync(colPath));
    await writePackage(out, async () => bytesSource(colBytes, 64 * 1024), unpacked.mediaNames.map((name, i) => ({
      name, open: async () => bytesSource(media.get(String(i))!.bytes(), 64 * 1024),
    })));

    // 5. Read our package back: the answers are in Anki's tables.
    const again = memorySink();
    await readPackage(bytesSource(out.bytes(), 64 * 1024), { collection: async () => again, media: async () => memorySink() });
    const back = join(work, 'back.anki2');
    writeBytes(back, again.bytes());
    const check = new DatabaseSync(back, { readOnly: true });
    for (const a of answers) {
      const r = check.prepare('SELECT ease, usn FROM revlog WHERE cid = ? ORDER BY id DESC LIMIT 1').get(a.cid) as any;
      expect(r).toMatchObject({ ease: a.ease, usn: -1 });
      expect((check.prepare('SELECT usn FROM cards WHERE id = ?').get(a.cid) as any).usn).toBe(-1);
    }
    check.close();
    expect(readdirSync(work)).toContain('collection.anki2');
  });
});
