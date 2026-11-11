import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { review } from '../../src/core/scheduler';
import { MemoryRepo, summarizeDecks } from '../../src/db/repo';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;

describe('repo', () => {
  it('summarizes decks and records new-card introductions', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const s = summarizeDecks(await repo.listNotes(), await repo.listCards(), { newPerDay: 20, dayStartsAtHour: H, now: NOW });
    expect(s).toEqual([{ deck: note.deck, due: 0, fresh: 1, total: 1 }]);
    const r = review(cards[0].sched, 3, NOW);
    await repo.addReview({ cardId: cards[0].id, ...r.log });
    expect(await repo.newIntroducedToday(note.deck, NOW, H)).toBe(1);
  });

  it('counts a 1 AM session against the study day before it', async () => {
    const repo = new MemoryRepo();
    const note = omniNote();
    const cards = makeCards(note, NOW);
    await repo.upsertNotesAndCards([note], cards);
    const lateNight = new Date(2026, 10, 12, 1, 0);
    await repo.addReview({ cardId: cards[0].id, ...review(cards[0].sched, 3, lateNight).log });
    expect(await repo.newIntroducedToday(note.deck, new Date(2026, 10, 11, 20, 0), H)).toBe(1);
    expect(await repo.newIntroducedToday(note.deck, new Date(2026, 10, 12, 9, 0), H)).toBe(0);
  });

  it('takes the new-card count off what was introduced today, as the review screen does', () => {
    const notes = [1, 2, 3].map((i) => ({ ...omniNote(), id: `n${i}` }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    const deck = notes[0].deck;
    const s = summarizeDecks(notes, cards, { newPerDay: 2, dayStartsAtHour: H, introducedByDeck: new Map([[deck, 1]]), now: NOW });
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
});
