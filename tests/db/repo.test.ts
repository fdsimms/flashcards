import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { review } from '../../src/core/scheduler';
import { MemoryRepo } from '../../src/db/repo';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;

describe('repo', () => {
  it('records new-card introductions per deck', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const r = review(cards[0].sched, 3, NOW);
    await repo.addReview({ cardId: cards[0].id, ...r.log });
    expect((await repo.studiedToday(NOW, H)).get(note.deck)).toEqual({ introduced: 1, reviewed: 0 });
  });

  it('counts a 1 AM session against the study day before it', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const lateNight = new Date(2026, 10, 12, 1, 0);
    await repo.addReview({ cardId: cards[0].id, ...review(cards[0].sched, 3, lateNight).log });
    expect((await repo.studiedToday(new Date(2026, 10, 11, 20, 0), H)).get(note.deck)?.introduced).toBe(1);
    expect((await repo.studiedToday(new Date(2026, 10, 12, 9, 0), H)).get(note.deck)).toBeUndefined();
  });

  it('counts answers to review cards separately from first answers to new ones', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const learned = review(review(card.sched, 3, NOW).sched, 3, NOW).sched; // now in Review
    await repo.addReview({ cardId: card.id, ...review(card.sched, 3, NOW).log });
    await repo.addReview({ cardId: card.id, ...review(learned, 3, NOW).log });
    await repo.addReview({ cardId: card.id, ...review(learned, 1, NOW).log });
    expect((await repo.studiedToday(NOW, H)).get(note.deck)).toEqual({ introduced: 1, reviewed: 2 });
  });

  it('takes an answer back with deleteReview', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const id = await repo.addReview({ cardId: card.id, ...review(card.sched, 3, NOW).log });
    await repo.deleteReview(id);
    expect((await repo.studiedToday(NOW, H)).size).toBe(0);
  });

  it('lists the answers logged from a time on, oldest first', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const at = (h: number) => new Date(2026, 10, 11, h);
    for (const h of [11, 9, 7]) await repo.addReview({ cardId: card.id, ...review(card.sched, 3, at(h)).log });
    expect((await repo.listReviews(at(8))).map((r) => new Date(r.reviewedAt).getHours())).toEqual([9, 11]);
  });

  it('lists a deck with its subdecks, not decks that merely share a prefix', async () => {
    const repo = new MemoryRepo();
    const notes = [['a', 'Polski'], ['b', 'Polski::Odmiana'], ['c', 'Polski Extra']].map(([id, deck]) => ({ ...omniNote(), id, deck }));
    await repo.upsertNotesAndCards(notes, notes.flatMap((n) => makeCards(n, NOW)));
    expect((await repo.listCards('Polski')).map((c) => c.noteId).sort()).toEqual(['a', 'b']);
  });

  it('never resets a studied card on re-import', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const [card] = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], [card]);
    const studied = { ...card, sched: review(card.sched, 3, NOW).sched };
    await repo.saveCard(studied);
    await repo.upsertNotesAndCards([note], makeCards(note, NOW));
    expect((await repo.listCards())[0].sched.reps).toBe(1);
  });

  it('retires cards a note stops generating, and brings them back with their history', async () => {
    const repo = new MemoryRepo();
    const withReverse = omniNote({ GenerateReverse: 'y' });
    const cards = makeCards(withReverse, NOW);
    await repo.upsertNotesAndCards([withReverse], cards);
    const rev = cards.find((c) => c.kind === 'reverse')!;
    await repo.saveCard({ ...rev, sched: review(rev.sched, 3, NOW).sched });

    const without = omniNote();
    await repo.upsertNotesAndCards([without], makeCards(without, NOW));
    expect((await repo.listCards()).find((c) => c.kind === 'reverse')!.retired).toBe(true);

    await repo.upsertNotesAndCards([withReverse], makeCards(withReverse, NOW));
    const back = (await repo.listCards()).find((c) => c.kind === 'reverse')!;
    expect(back.retired).toBe(false);
    expect(back.sched.reps).toBe(1);
  });

  it('keeps deck settings and note types for those a later import leaves out', async () => {
    const repo = new MemoryRepo();
    const p = (r: number) => ({ weights: [], desiredRetention: r, maxInterval: 36500 });
    await repo.saveDeckParams(new Map([['A', p(0.9)], ['B', p(0.8)]]));
    await repo.saveDeckParams(new Map([['A', p(0.85)]]));
    const all = await repo.listDeckParams();
    expect(all.get('A')!.desiredRetention).toBe(0.85);
    expect(all.get('B')!.desiredRetention).toBe(0.8);
    const type = (name: string) => ({ name, kind: 'normal' as const, fields: [], css: '', templates: [] });
    await repo.saveNoteTypes([type('Basic'), type('Geo')]);
    await repo.saveNoteTypes([{ ...type('Basic'), css: '.card {}' }]);
    const types = await repo.listNoteTypes();
    expect([...types.keys()].sort()).toEqual(['Basic', 'Geo']);
    expect(types.get('Basic')!.css).toBe('.card {}');
  });

  it("takes a whole Anki collection as the record: overwrites studied cards, retires Anki cards it dropped", async () => {
    const repo = new MemoryRepo();
    const anki = { ...omniNote(), id: 'a' };
    const local = { ...omniNote(), id: 'local' };
    const [ankiCard] = makeCards(anki, NOW).map((c) => ({ ...c, ankiId: '1001' }));
    const [gone] = makeCards({ ...omniNote(), id: 'gone' }, NOW).map((c) => ({ ...c, ankiId: '1002' }));
    const [localCard] = makeCards(local, NOW);
    await repo.upsertNotesAndCards([anki, local], [ankiCard, gone, localCard]);
    await repo.saveCard({ ...ankiCard, sched: review(ankiCard.sched, 3, NOW).sched }); // studied here

    const fromAnki = { ...ankiCard, sched: { ...ankiCard.sched, reps: 7 } };
    await repo.applyAnkiCollection([anki], [fromAnki]);
    const cards = new Map((await repo.listCards()).map((c) => [c.id, c]));
    expect(cards.get(ankiCard.id)!.sched.reps).toBe(7);
    expect(cards.get(gone.id)!.retired).toBe(true);
    expect(cards.get(localCard.id)!.retired).toBe(false);
  });
});
