import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildExport, collectionSettings, readDeckConfig, readDeckKind, readFilteredDeck } from '../../src/anki/collection';
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

  it("reads a preset's burying options", () => {
    // Anki's own encoding (deck_config_pb2) of new 7, reviews 70, bury new and interday learning.
    expect(readDeckConfig(hex('48075046D80101E80101'))).toMatchObject({
      newPerDay: 7, reviewsPerDay: 70, buryNew: true, buryReviews: false, buryInterdayLearning: true,
    });
  });

  it("reads a preset's steps, leech and order options, a deck's today-only limit, and a filtered deck", () => {
    // Each encoded by Anki itself (deck_config_pb2 / decks_pb2).
    expect(readDeckConfig(hex('0A0C0000803F000020410000B444120400002041A80101B00108F00102F80101800203880207900201'))).toMatchObject({
      learnSteps: [1, 10, 1440], relearnSteps: [10], leechAction: 1, leechThreshold: 8,
      newMix: 2, interdayLearningMix: 1, newSortOrder: 3, reviewOrder: 7, newGatherPriority: 1,
    });
    expect(readDeckKind(hex('0A0B080530324A05081E10AC06'))).toMatchObject({ configId: 5, reviewLimit: 50, newLimitToday: { limit: 30, today: 812 } });
    expect(readFilteredDeck(hex('120C120A0A0669733A647565100A'))).toEqual({ reschedule: false });
    expect(readFilteredDeck(hex('0A0408013803'))).toBeUndefined();
  });

  it("reads the collection's day start, learn-ahead and v3 options, with Anki's defaults when missing", () => {
    const val = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
    expect(collectionSettings([
      { key: 'rollover', val: val(2) }, { key: 'collapseTime', val: val(600) },
      { key: 'newCardsIgnoreReviewLimit', val: val(true) }, { key: 'applyAllParentLimits', val: val(true) },
    ])).toEqual({ dayStartsAtHour: 2, learnAheadMinutes: 10, newCardsIgnoreReviewLimit: true, applyAllParentLimits: true });
    expect(collectionSettings(undefined)).toEqual({ dayStartsAtHour: 4, learnAheadMinutes: 20, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false });
  });

  it("imports each card's own deck, filtered deck, new-card position and learning step", async () => {
    const rows = await readCollectionRows(FIXTURE);
    const data = buildExport(rows);
    const res = importAnkiJson(data, { now: NOW });
    // Peru's card is in Filtered Deck 1: studied there, home deck Trivia.
    const peru = res.cards.find((c) => c.filteredDeck)!;
    expect(peru.filteredDeck).toBe('Filtered Deck 1');
    expect(res.notes.find((n) => n.id === peru.noteId)!.deck).toBe('🧠 Trivia');
    // New cards keep Anki's position.
    const fresh = data.cards.filter((c) => c.type === 0);
    for (const c of fresh) expect(res.cards.find((x) => x.ankiId === String(c.cardId))?.position).toBe(c.due);
    // A learning card on its second of two steps (1 step left) is at step 1.
    const learning = data.cards.find((c) => c.type === 1)!;
    expect(learning.stepsLeft).toBeGreaterThan(0);
    const steps = data.deckConfigs[learning.deckName].learnSteps!.length;
    expect(res.cards.find((x) => x.ankiId === String(learning.cardId))!.sched.learningSteps).toBe(Math.max(0, steps - learning.stepsLeft!));
  });

  it('reads notes, scheduling, deck settings and note types', async () => {
    const data = buildExport(await readCollectionRows(FIXTURE));
    expect(data.notes).toHaveLength(7);
    expect(data.notes[0]).toMatchObject({ modelName: 'Basic (and reversed card)', tags: ['a1', 'noun'], fields: { Front: 'หนังสือ', Back: 'book' } });
    expect(data.deckConfigs[THAI]).toMatchObject({ newPerDay: 1, reviewsPerDay: 150, desiredRetention: 0.85, maxInterval: 3650 });
    expect(data.deckConfigs[THAI].weights).toHaveLength(21);
    expect(data.deckConfigs['🧠 Trivia']).toMatchObject({ newPerDay: 3, reviewsPerDay: 200 });
    expect(data.deckConfigs['Filtered Deck 1']).toEqual({ filtered: { reschedule: true } });
    expect(data.collectionSettings).toEqual({ dayStartsAtHour: 4, learnAheadMinutes: 20, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false });
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
