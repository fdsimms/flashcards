import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCustomStudyDeck, CustomStudyRefused, emptyFilteredDeck, setAnkiDayLimits } from '../../src/anki/customStudyWrites';
import { deckJson } from '../../src/anki/sync/deckRows';
import type { CustomStudy } from '../../src/core/customStudy';
import { CUSTOM_STUDY_DECK } from '../../src/core/customStudy';
import { nodeSyncDb } from '../support/syncDb';

const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const NOW = new Date(2026, 10, 11, 12);
const NOW_SECS = Math.floor(NOW.getTime() / 1000);
const TRIVIA = '🧠 Trivia';
const THAI = '👅 Languages::🐘 ภาษาไทย';
const CTX = { today: 2, dayEndSecs: NOW_SECS + 3600 };

async function kept(unicase = true) {
  const dir = mkdtempSync(join(tmpdir(), 'customstudy-'));
  copyFileSync(FIXTURE, join(dir, 'collection.anki2'));
  return nodeSyncDb(join(dir, 'collection.anki2'), { unicase });
}
type Db = Awaited<ReturnType<typeof kept>>;

const row = (r: any) => ({ id: r.id, name: r.name, mtime: r.mtime_secs, usn: r.usn, common: r.common, kind: r.kind });
const deckNamed = async (db: Db, name: string) => (await db.all<any>('SELECT * FROM decks NOT INDEXED')).find((d) => d.name.split('\x1f').join('::') === name);
const card = (db: Db, id: number) => db.first<any>('SELECT did, odid, type, queue, due, odue, usn FROM cards WHERE id = ?', id);
const build = (db: Db, deck: string, study: CustomStudy, ctx = CTX, sessionDeck = CUSTOM_STUDY_DECK) => buildCustomStudyDeck(db, { deck, sessionDeck, study, ctx, now: NOW });
const cram = (select: 'new' | 'due' | 'review' | 'all', over: Partial<Extract<CustomStudy, { kind: 'cram' }>> = {}): CustomStudy => ({ kind: 'cram', select, count: 100, include: [], exclude: [], ...over });

describe("a deck's limits for today in the kept collection", () => {
  it("sets the new-card limit for the day and leaves the rest of the deck as it was", async () => {
    const db = await kept();
    const before = deckJson(row(await deckNamed(db, TRIVIA)));
    expect(await setAnkiDayLimits(db, TRIVIA, { newLimit: 25 }, 800, NOW)).toBe(true);
    const after = await deckNamed(db, TRIVIA);
    expect(deckJson(row(after))).toEqual({ ...before, mod: NOW_SECS, usn: -1, newLimitToday: { limit: 25, today: 800 } });
    expect(after.usn).toBe(-1);
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('sets both limits, and replaces a limit already set for the day', async () => {
    const db = await kept();
    await setAnkiDayLimits(db, TRIVIA, { newLimit: 25, reviewLimit: 300 }, 800, NOW);
    await setAnkiDayLimits(db, TRIVIA, { newLimit: 40 }, 800, NOW);
    expect(deckJson(row(await deckNamed(db, TRIVIA)))).toMatchObject({ newLimitToday: { limit: 40, today: 800 }, reviewLimitToday: { limit: 300, today: 800 }, newLimit: 3 });
    db.close();
  });

  it('is false for a deck Anki does not have, and for a filtered deck', async () => {
    const db = await kept();
    expect(await setAnkiDayLimits(db, 'Nope', { newLimit: 5 }, 1, NOW)).toBe(false);
    expect(await setAnkiDayLimits(db, 'Filtered Deck 1', { newLimit: 5 }, 1, NOW)).toBe(false);
    db.close();
  });
});

describe('Custom Study Session in the kept collection', () => {
  it('moves new cards in as a preview, in the order added, leaving out suspended cards and those already in a filtered deck', async () => {
    const db = await kept();
    const r = await build(db, TRIVIA, cram('new'));
    // Notes ..018, ..030, then ..031's two cards (ord 0 before ord 1); the suspended ..019 and the one in Filtered Deck 1 stay.
    expect(r.ankiIds).toEqual(['1794408858020', '1794408858030', '1794408858032', '1794408858031']);
    const session = await deckNamed(db, CUSTOM_STUDY_DECK);
    expect(session.usn).toBe(-1);
    expect(deckJson(row(session))).toMatchObject({ dyn: 1, resched: false, terms: [[`deck:"${TRIVIA}" is:new`, 100, 5]], previewAgainSecs: 60, previewHardSecs: 600, previewGoodSecs: 0 });
    // Position stands in for the card's due; its own is kept in odue; every card is in the review
    // queue, as Anki builds a deck that doesn't reschedule.
    expect(await card(db, 1794408858020)).toMatchObject({ did: session.id, odid: 1794408857991, type: 0, queue: 2, due: -100000, odue: 5, usn: -1 });
    expect(await card(db, 1794408858031)).toMatchObject({ queue: 2, due: -99997, odue: 7 });
    expect(await card(db, 1794408858019)).toMatchObject({ did: 1794408857991, odid: 0, queue: -1 });
    expect(await card(db, 1794408858018)).toMatchObject({ did: 1794408858039, odid: 1794408857991, odue: 10 });
    expect((await db.first<{ mod: number }>('SELECT mod FROM col'))!.mod).toBe(NOW.getTime());
    db.close();
  });

  it('keeps reviews in the review queue when the session reschedules (review ahead), taking only those due within the days', async () => {
    const db = await kept();
    const r = await build(db, THAI, { kind: 'ahead', days: 1 });
    // Two review cards are due on days 3 and 4, today is 2: only the first. The learning card and the new one stay.
    expect(r.ankiIds).toEqual(['1794408858014']);
    expect(await card(db, 1794408858014)).toMatchObject({ queue: 2, due: -100000, odue: 3, odid: 1794408857990 });
    expect(deckJson(row(await deckNamed(db, CUSTOM_STUDY_DECK)))).toMatchObject({ resched: true, terms: [[`deck:"${THAI}" prop:due<=1`, 9999, 6]] });
    expect(await card(db, 1794408858016)).toMatchObject({ odid: 0, queue: 1 });
    db.close();
  });

  it('takes cards answered Again within the days, and no others', async () => {
    const db = await kept();
    const dayAgo = (NOW_SECS - 3 * 3600) * 1000;
    await db.run('INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, 1794408858020, 0, 1, 0, 0, 0, 5000, 0)', dayAgo);
    await db.run('INSERT INTO revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) VALUES (?, 1794408858030, 0, 3, 0, 0, 0, 5000, 0)', dayAgo + 1);
    const r = await build(db, TRIVIA, { kind: 'forgotten', days: 1 });
    expect(r.ankiIds).toEqual(['1794408858020']);
    expect((await build(db, TRIVIA, { kind: 'forgotten', days: 1 }, CTX)).moved).toBe(1);
    db.close();
  });

  it('previews only new cards added within the days (a card id is its time in milliseconds)', async () => {
    const db = await kept();
    // The fixture's cards are all newer than NOW: age every new card but one.
    await db.run('UPDATE cards SET id = id - 864000000000 WHERE type = 0 AND id != 1794408858030');
    await db.run('UPDATE cards SET id = ? WHERE id = 1794408858030', (NOW_SECS - 600) * 1000);
    const r = await build(db, TRIVIA, { kind: 'previewNew', days: 1 });
    expect(r.ankiIds).toEqual([String((NOW_SECS - 600) * 1000)]);
    db.close();
  });

  it('picks by state: due reviews, all reviews, all cards', async () => {
    const db = await kept();
    expect((await build(db, THAI, cram('due'), { today: 3, dayEndSecs: CTX.dayEndSecs })).ankiIds).toEqual(['1794408858014']);
    expect((await build(db, THAI, cram('review'))).moved).toBe(2);
    // The learning card is never taken.
    expect((await build(db, THAI, cram('all'))).ankiIds.sort()).toEqual(['1794408858014', '1794408858015', '1794408858017']);
    db.close();
  });

  it('picks by tag, matching the tags under one, and leaves out excluded tags', async () => {
    const db = await kept();
    expect((await build(db, THAI, cram('review', { include: ['A1'] }))).ankiIds.sort()).toEqual(['1794408858014', '1794408858015']);
    await expect(build(db, THAI, cram('review', { include: ['noun'], exclude: ['a1'] }))).rejects.toBeInstanceOf(CustomStudyRefused);
    expect((await build(db, THAI, cram('all', { exclude: ['a1'] }))).ankiIds).toEqual(['1794408858017']);
    await db.run("UPDATE notes SET tags = ' verb::irregular ' WHERE id = 1794408858015");
    expect((await build(db, THAI, cram('all', { include: ['verb'] }))).ankiIds).toEqual(['1794408858017']);
    db.close();
  });

  it('limits the cards to the count asked for', async () => {
    const db = await kept();
    expect((await build(db, TRIVIA, cram('new', { count: 2 }))).ankiIds).toEqual(['1794408858020', '1794408858030']);
    db.close();
  });

  it('empties the session deck before filling it again, so its cards are chosen afresh', async () => {
    const db = await kept();
    await build(db, TRIVIA, cram('new', { count: 1 }));
    const first = await deckNamed(db, CUSTOM_STUDY_DECK);
    const r = await build(db, TRIVIA, cram('new', { count: 2 }));
    const again = await deckNamed(db, CUSTOM_STUDY_DECK);
    expect(again.id).toBe(first.id);
    expect(r.ankiIds).toEqual(['1794408858020', '1794408858030']);
    expect((await db.all<any>('SELECT id FROM decks NOT INDEXED')).length).toBe(6);
    // The card that came out and wasn't taken again is home and new, as before.
    expect(await card(db, 1794408858031)).toMatchObject({ did: 1794408857991, odid: 0, queue: 0, due: 7 });
    db.close();
  });

  it('changes nothing when no card matches, even the session deck being emptied', async () => {
    const db = await kept();
    await build(db, TRIVIA, cram('new', { count: 1 }));
    const before = await db.all<any>('SELECT * FROM cards ORDER BY id');
    await expect(build(db, TRIVIA, { kind: 'forgotten', days: 1 })).rejects.toThrow('No cards match');
    expect(await db.all<any>('SELECT * FROM cards ORDER BY id')).toEqual(before);
    db.close();
  });

  it('refuses a name that is a normal deck, and a deck Anki does not have', async () => {
    const db = await kept();
    await expect(build(db, TRIVIA, cram('new'), CTX, 'Default')).rejects.toThrow("isn't a filtered deck");
    await expect(build(db, 'Nope', cram('new'))).rejects.toThrow('no deck called');
    db.close();
  });

  it('says so, changing nothing, when the build lacks the collation a new deck needs', async () => {
    const db = await kept(false);
    await expect(build(db, TRIVIA, cram('new'))).rejects.toThrow("can't add a deck");
    expect((await db.all<any>('SELECT id FROM decks NOT INDEXED')).length).toBe(5);
    db.close();
  });

  it('studies the deck and its subdecks', async () => {
    const db = await kept();
    expect((await build(db, '👅 Languages', cram('review'))).moved).toBe(2);
    db.close();
  });
});

describe('emptying a filtered deck', () => {
  it('sends cards home with their due, keeps a card suspended since, and restores the queue of a preview', async () => {
    const db = await kept();
    await build(db, TRIVIA, cram('new'));
    const session = await deckNamed(db, CUSTOM_STUDY_DECK);
    await db.run('UPDATE cards SET queue = -1 WHERE id = 1794408858030');
    expect(await emptyFilteredDeck(db, session.id, NOW)).toBe(4);
    expect(await card(db, 1794408858020)).toMatchObject({ did: 1794408857991, odid: 0, queue: 0, due: 5, odue: 0 });
    expect(await card(db, 1794408858030)).toMatchObject({ queue: -1, due: 6 });
    db.close();
  });

  it("puts a new card Anki left in the review queue (built without rescheduling) back in the new queue", async () => {
    const db = await kept();
    await build(db, TRIVIA, cram('new'));
    const session = await deckNamed(db, CUSTOM_STUDY_DECK);
    await db.run('UPDATE cards SET queue = 2 WHERE id = 1794408858020');
    await emptyFilteredDeck(db, session.id, NOW);
    expect(await card(db, 1794408858020)).toMatchObject({ type: 0, queue: 0, due: 5 });
    db.close();
  });
});
