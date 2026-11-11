import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, readDeckKind } from '../../src/anki/collection';
import { importAnkiJson } from '../../src/import/ankiJson';
import { readCollectionRows } from '../support/ankiRows';
import { NOW } from '../support/fixtures';

/** A real collection written by Anki itself (tests/fixtures/anki/make-collection.py builds it). */
const FIXTURE = join(__dirname, '..', 'fixtures', 'anki', 'collection.anki2');
const THAI = '👅 Languages::🐘 ภาษาไทย';
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('reading a collection', () => {
  it('reads a deck kind blob Anki wrote', () => {
    expect(readDeckKind(hex('0A0408013803'))).toEqual({ configId: 1, newLimit: 3, reviewLimit: undefined, desiredRetention: undefined });
    expect(readDeckKind(hex('12260801'))).toBeUndefined(); // filtered
  });

  it('reads notes, scheduling, deck settings and note types', async () => {
    const data = buildExport(await readCollectionRows(FIXTURE));
    expect(data.notes).toHaveLength(7);
    expect(data.notes[0]).toMatchObject({ modelName: 'Basic (and reversed card)', tags: ['a1', 'noun'], fields: { Front: 'หนังสือ', Back: 'book' } });
    expect(data.deckConfigs[THAI]).toMatchObject({ newPerDay: 1, reviewsPerDay: 150, desiredRetention: 0.85, maxInterval: 3650 });
    expect(data.deckConfigs[THAI].weights).toHaveLength(21);
    expect(data.deckConfigs['🧠 Trivia']).toMatchObject({ newPerDay: 3, reviewsPerDay: 200 });
    expect(data.deckConfigs['Filtered Deck 1']).toBeUndefined();
    const learning = data.cards.find((c) => c.queue === 1)!;
    expect(learning.due!).toBeGreaterThan(1_000_000_000);
    expect(learning.memoryState!.stability).toBeGreaterThan(0);
    // The card borrowed into the filtered deck reads under its home deck.
    expect(data.cards.filter((c) => c.deckName === 'Filtered Deck 1')).toHaveLength(0);
    expect(data.noteTypes.map((t) => [t.name, t.kind, t.templates.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ['Basic', 'normal', 1], ['Basic (and reversed card)', 'normal', 2], ['Cloze', 'cloze', 1],
    ]);
  });

  it('keeps when a buried card was buried, and reads it as its ordinary queue', async () => {
    const rows = await readCollectionRows(FIXTURE);
    const review = rows.cards.find((c) => Number(c.queue) === 2)!;
    const buriedAt = new Date(2026, 10, 11, 9, 30);
    review.queue = -3;
    review.mod = buriedAt.getTime() / 1000;
    const res = importAnkiJson(buildExport(rows), { now: NOW });
    const card = res.cards.find((c) => c.ankiId === String(review.id))!;
    expect(card.buriedAt).toBe(buriedAt.toISOString());
    expect(card.sched.state).toBe(2);
    expect(res.cards.filter((c) => c.buriedAt)).toHaveLength(1);
  });

  it('imports with every Anki card, its scheduling and its Anki card id', async () => {
    const data = buildExport(await readCollectionRows(FIXTURE));
    const res = importAnkiJson(data, { now: NOW });
    expect(res.warnings).toEqual([]);
    const book = res.notes.find((n) => n.fields.Front === 'หนังสือ')!;
    const cards = res.cards.filter((c) => c.noteId === book.id);
    expect(cards.map((c) => c.kind)).toEqual(['t0', 't1']);
    expect(cards[0].sched.state).toBe(2);
    // Each card remembers which Anki card it is, so answers can be written back to it.
    expect(cards.map((c) => c.ankiId)).toEqual(data.cards.filter((c) => c.note === book.id).map((c) => String(c.cardId)));
  });
});
