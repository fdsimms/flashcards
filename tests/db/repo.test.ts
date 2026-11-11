import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { review } from '../../src/core/scheduler';
import { queueOptionsFor } from '../../src/core/queue';
import { MemoryRepo, summarizeDecks } from '../../src/db/repo';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const base = { defaultNewPerDay: 20, defaultReviewsPerDay: 200, dayStartsAtHour: H, now: NOW };
const fresh = { introduced: 0, reviewed: 0 };

describe('repo', () => {
  it('summarizes decks and records new-card introductions', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const s = summarizeDecks(await repo.listNotes(), await repo.listCards(), () => queueOptionsFor(undefined, fresh, base));
    expect(s).toEqual([{ deck: note.deck, due: 0, fresh: 1, total: 1 }]);
    const r = review(cards[0].sched, 3, NOW);
    await repo.addReview({ cardId: cards[0].id, ...r.log });
    expect(await repo.studiedToday(note.deck, NOW, H)).toEqual({ introduced: 1, reviewed: 0 });
  });

  it('counts a 1 AM session against the study day before it', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const lateNight = new Date(2026, 10, 12, 1, 0);
    await repo.addReview({ cardId: cards[0].id, ...review(cards[0].sched, 3, lateNight).log });
    expect((await repo.studiedToday(note.deck, new Date(2026, 10, 11, 20, 0), H)).introduced).toBe(1);
    expect((await repo.studiedToday(note.deck, new Date(2026, 10, 12, 9, 0), H)).introduced).toBe(0);
  });

  it('takes the new-card count off what was introduced today, as the review screen does', () => {
    const notes = [1, 2, 3].map((i) => ({ ...omniNote(), id: `n${i}` }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    const deck = notes[0].deck;
    const s = summarizeDecks(notes, cards, (d) => queueOptionsFor(
      { weights: [], desiredRetention: 0.9, maxInterval: 36500, newPerDay: 2 },
      d === deck ? { introduced: 1, reviewed: 0 } : fresh,
      base,
    ));
    expect(s[0].fresh).toBe(1);
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
    expect(summarizeDecks([without], await repo.listCards(), () => queueOptionsFor(undefined, fresh, base))[0].total).toBe(1);

    await repo.upsertNotesAndCards([withReverse], makeCards(withReverse, NOW));
    const back = (await repo.listCards()).find((c) => c.kind === 'reverse')!;
    expect(back.retired).toBe(false);
    expect(back.sched.reps).toBe(1);
  });

  it('keeps deck settings for decks a later import leaves out', async () => {
    const repo = new MemoryRepo();
    const p = (r: number) => ({ weights: [], desiredRetention: r, maxInterval: 36500 });
    await repo.saveDeckParams(new Map([['A', p(0.9)], ['B', p(0.8)]]));
    await repo.saveDeckParams(new Map([['A', p(0.85)]]));
    const all = await repo.listDeckParams();
    expect(all.get('A')!.desiredRetention).toBe(0.85);
    expect(all.get('B')!.desiredRetention).toBe(0.8);
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
    expect(await repo.studiedToday(note.deck, NOW, H)).toEqual({ introduced: 1, reviewed: 2 });
  });
});
