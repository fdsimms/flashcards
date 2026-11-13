import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inSchema, keptSql, stripUnicaseIn } from '../../src/anki/attachedSql';
import { buildExport, COLLECTION_QUERIES, type CollectionRows } from '../../src/anki/collection';
import { readPackage, writePackage } from '../../src/anki/package';
import { cardRestoreParams, cardStateParams, cardUpdate, cardUpdateParams, nextRevlogId, revlogEntry, revlogParams, type AnkiCardRow } from '../../src/anki/writeback';
import { review } from '../../src/core/scheduler';
import { isBuried } from '../../src/core/queue';
import type { Card } from '../../src/core/types';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { bytesSource, fileSource, memorySink, writeBytes } from '../support/bytes';

const DIR = join(__dirname, '..', 'fixtures', 'anki');

/**
 * The statements src/db/ankiLink.ts runs on the phone, in the same order, on one connection
 * with the collections attached, as the app does. The phone's expo-sqlite and Node's SQLite are
 * the same engine; what this can't cover is the file handling around it.
 */
describe('the app\'s SQL against attached Anki collections', () => {
  it('reads a scratch copy, writes answers into the kept collection, undoes one, and packs it', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const work = mkdtempSync(join(tmpdir(), 'att-'));

    // Unpack Anki's own package, as the import does.
    const col = memorySink();
    const media = new Map<string, ReturnType<typeof memorySink>>();
    const unpacked = await readPackage(fileSource(join(DIR, 'collection.colpkg')), {
      collection: async () => col,
      media: async (i) => { const s = memorySink(); media.set(i, s); return s; },
    });
    const kept = join(work, 'collection.anki2');
    writeBytes(kept, col.bytes());

    const db = new DatabaseSync(join(work, 'franki.db'));
    db.exec('PRAGMA journal_mode = WAL; CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');

    // readAnkiRows: a scratch copy, collation stripped, attached again, read.
    const scratch = join(work, 'scratch.anki2');
    copyFileSync(kept, scratch);
    db.prepare('ATTACH DATABASE ? AS scratch').run(scratch);
    db.exec('PRAGMA scratch.journal_mode = DELETE');
    db.exec('PRAGMA writable_schema = ON');
    db.exec(stripUnicaseIn('scratch'));
    db.exec('PRAGMA writable_schema = OFF');
    db.exec('DETACH DATABASE scratch');
    db.prepare('ATTACH DATABASE ? AS scratch').run(scratch);
    const all = (sql: string) => db.prepare(inSchema(sql, 'scratch')).all() as any[];
    const rows: CollectionRows = {
      col: db.prepare(inSchema(COLLECTION_QUERIES.col, 'scratch')).get() as any,
      notetypes: all(COLLECTION_QUERIES.notetypes), fields: all(COLLECTION_QUERIES.fields), templates: all(COLLECTION_QUERIES.templates),
      notes: all(COLLECTION_QUERIES.notes), cards: all(COLLECTION_QUERIES.cards), decks: all(COLLECTION_QUERIES.decks),
      deckConfigs: all(COLLECTION_QUERIES.deckConfigs), lastReviews: all(COLLECTION_QUERIES.lastReviews),
    };
    db.exec('DETACH DATABASE scratch');
    const data = buildExport(rows);
    expect(data.notes).toHaveLength(7);
    const cards = importAnkiJson(data).cards;

    // keepAnkiCollection + writeAnkiAnswer: the kept file attached as `anki`, never stripped.
    db.prepare('ATTACH DATABASE ? AS anki').run(kept);
    db.exec('PRAGMA anki.journal_mode = DELETE');
    const SQL = keptSql('anki');
    const crt = (db.prepare(SQL.crt).get() as any).crt as number;
    // Every deck, the deck list's empty ones included, read without Anki's collation.
    expect((db.prepare(SQL.decks).all() as any[]).map((d) => d.name).sort()).toEqual(
      ['Default', 'Filtered Deck 1', '👅 Languages', '👅 Languages\x1f🐘 ภาษาไทย', '🧠 Trivia'].sort(),
    );
    const now = new Date();
    const answer = (before: Card, rating: 1 | 2 | 3 | 4) => {
      const after: Card = { ...before, sched: review(before.sched, rating, now).sched };
      const cid = Number(before.ankiId);
      const row = db.prepare(SQL.cardRow).get(cid) as unknown as AnkiCardRow & { mod: number; usn: number };
      const id = nextRevlogId(now.getTime(), (db.prepare(SQL.maxRevlogId).get() as any).m);
      db.exec('BEGIN');
      db.prepare(SQL.cardUpdate).run(...cardUpdateParams(cardUpdate(after, row, { clock: { crt, dayStartsAtHour: 4 }, now }), cid));
      db.prepare(SQL.revlogInsert).run(...revlogParams(revlogEntry(before, after, rating, { id, cid, previousIvl: row.ivl, now, takenMs: 3000 })));
      db.exec('COMMIT');
      return { cid, row, id, rating };
    };
    const kept1 = answer(cards.find((c) => c.sched.state === 2)!, 3);
    const undone = answer(cards.find((c) => c.sched.state === 0 && !c.suspended)!, 4);
    // undoAnkiAnswer
    db.exec('BEGIN');
    db.prepare(SQL.cardUpdate).run(...cardRestoreParams(undone.row, undone.cid));
    db.prepare(SQL.revlogDelete).run(undone.id);
    db.exec('COMMIT');
    expect((db.prepare(SQL.unsentSince).get(0) as any).n).toBeGreaterThanOrEqual(1);
    // writeAnkiAnswer's bury: a sibling held back as Anki's scheduler buries it, then undone with
    // its answer, which puts the sibling's row back exactly as it was.
    const first = cards.find((c) => c.sched.state === 0 && !c.suspended && cards.some((s) => s.noteId === c.noteId && s.id !== c.id))!;
    const sibCid = Number(cards.find((s) => s.noteId === first.noteId && s.id !== first.id)!.ankiId);
    const sibRow = db.prepare(SQL.cardRow).get(sibCid);
    db.prepare(SQL.buryCard).run(Math.floor(now.getTime() / 1000), sibCid);
    const buried = db.prepare(SQL.cardRow).get(sibCid) as any;
    expect([buried.queue, buried.usn, buried.mod]).toEqual([-2, -1, Math.floor(now.getTime() / 1000)]);
    // The bury is a change a full download would lose, besides the answers.
    expect((db.prepare(SQL.unsentEdits).get() as any).n).toBeGreaterThanOrEqual(1);
    db.prepare(SQL.cardUpdate).run(...cardRestoreParams(sibRow as any, sibCid));
    expect(db.prepare(SQL.cardRow).get(sibCid)).toEqual(sibRow);
    // Stats read the review log from a time on: the kept answer is there, the undone one isn't.
    const log = db.prepare(SQL.revlogSince).all(now.getTime() - 1000) as any[];
    expect(log.map((r) => [r.id, r.cid, r.ease])).toEqual([[kept1.id, kept1.cid, 3]]);
    db.exec('DETACH DATABASE anki');
    db.close();

    // The kept file is complete on disk (rollback journal, nothing pending), and still Anki's
    // schema: the collation was only ever stripped from the scratch copy.
    const bytes = new Uint8Array(readFileSync(kept));
    expect(bytes[18]).toBe(1);
    const check = new DatabaseSync(kept, { readOnly: true });
    expect((check.prepare("SELECT sql FROM sqlite_master WHERE name = 'fields'").get() as any).sql).toContain('COLLATE unicase');
    expect((check.prepare('SELECT ease FROM revlog WHERE id = ?').get(kept1.id) as any).ease).toBe(3);
    expect(check.prepare('SELECT 1 FROM revlog WHERE id = ?').get(undone.id)).toBeUndefined();
    expect((check.prepare('SELECT type, usn FROM cards WHERE id = ?').get(undone.cid) as any)).toMatchObject({ type: 0, usn: undone.row.usn });
    check.close();

    // Packed for Anki. FRANKI_VERIFY_OUT keeps it for tests/fixtures/anki/verify-package.py.
    const out = memorySink();
    await writePackage(out, async () => bytesSource(bytes, 64 * 1024), unpacked.mediaNames.map((name, i) => ({
      name, open: async () => bytesSource(media.get(String(i))!.bytes(), 64 * 1024),
    })));
    if (process.env.FRANKI_VERIFY_OUT) {
      writeBytes(process.env.FRANKI_VERIFY_OUT, out.bytes());
      writeBytes(`${process.env.FRANKI_VERIFY_OUT}.answers.json`, new TextEncoder().encode(JSON.stringify([{ cid: kept1.cid, ease: kept1.rating }])));
    }
    expect(out.bytes().length).toBeGreaterThan(1000);
  });

  it("writes a card's suspend, bury and flag into the kept collection, and reads them back as Anki does", async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const work = mkdtempSync(join(tmpdir(), 'att-state-'));
    const kept = join(work, 'collection.anki2');
    copyFileSync(join(DIR, 'collection.anki2'), kept);
    const db = new DatabaseSync(join(work, 'franki.db'));
    db.prepare('ATTACH DATABASE ? AS anki').run(kept);
    const SQL = keptSql('anki');
    const now = new Date(2026, 10, 11, 12);
    const [a, b] = (db.prepare('SELECT id FROM anki.cards WHERE queue >= 0 ORDER BY id LIMIT 2').all() as any[]).map((r) => Number(r.id));
    // setAnkiCardStates, for each change.
    const set = (cid: number, state: { suspended: boolean; buried: boolean; flag: number }) =>
      db.prepare(SQL.cardStateUpdate).run(...cardStateParams(db.prepare(SQL.cardState).get(cid) as any, state, now, cid));
    set(a, { suspended: true, buried: false, flag: 2 });
    set(b, { suspended: false, buried: true, flag: 0 });
    db.exec('DETACH DATABASE anki');
    db.close();

    const cards = importAnkiJson(buildExport(await readCollectionRows(kept)), { now }).cards;
    const byAnki = (cid: number) => cards.find((c) => c.ankiId === String(cid))!;
    expect([byAnki(a).suspended, byAnki(a).flag]).toEqual([true, 2]);
    expect(isBuried(byAnki(b), now, 4)).toBe(true);
    const check = new DatabaseSync(kept, { readOnly: true });
    expect(check.prepare('SELECT queue, flags, usn FROM cards WHERE id = ?').get(b)).toEqual({ queue: -3, flags: 0, usn: -1 });
    check.close();
  });
});
