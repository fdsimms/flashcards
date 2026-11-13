import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { treeQueue } from '../../src/core/deckTree';
import { isBuried, isDue, nextCard, nextLearningDue, siblingsToBury, studiedToday } from '../../src/core/queue';
import { review } from '../../src/core/scheduler';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;

/** One deck holding `cards`, with room to spare, as the review screen would study it. */
function oneDeck(cards: Card[], opts: { now: Date; dayStartsAtHour: number }) {
  return treeQueue('D', {
    cardsByDeck: new Map([['D', cards]]), limitsFor: () => ({ newPerDay: 99, reviewsPerDay: 999 }),
    studiedByDeck: new Map(), dayStartsAtHour: opts.dayStartsAtHour, now: opts.now,
  });
}

function withSched(card: Card, over: Partial<Card['sched']>): Card {
  return { ...card, sched: { ...card.sched, ...over } };
}

describe('queue', () => {
  it('orders reviews by due day, and mixes new cards in among them', () => {
    const notes = [1, 2, 3, 4].map((i) => ({ ...omniNote(), id: `n${i}` }));
    const cards = notes.flatMap((n) => makeCards(n, NOW));
    cards[0] = withSched(cards[0], { state: 2, due: new Date(2026, 10, 1).toISOString() });
    cards[1] = withSched(cards[1], { state: 2, due: new Date(2026, 9, 1).toISOString() });
    const q = oneDeck(cards, { dayStartsAtHour: H, now: new Date(2027, 0, 1, 12) });
    expect(q.due.map((c) => c.id)).toEqual([cards[1].id, cards[0].id]);
    expect(q.fresh).toHaveLength(2);
    expect(nextCard(q)?.id).toBe(cards[1].id);
    // Anki's default spaces 2 new cards through 2 reviews: review, new, review, new.
    expect(q.order.map((c) => c.sched.state === 0 ? 'new' : 'review')).toEqual(['review', 'new', 'review', 'new']);
  });
  it('shows a review card for its whole study day, not from the minute it falls due', () => {
    const [base] = makeCards(omniNote(), NOW);
    const card = withSched(base, { state: 2, due: new Date(2026, 10, 12, 21, 0).toISOString() });
    expect(isDue(card, new Date(2026, 10, 12, 8, 0), H)).toBe(true);
    // Before the reset hour it's still the 11th's study day, so the 12th's review isn't due yet.
    expect(isDue(card, new Date(2026, 10, 12, 2, 0), H)).toBe(false);
    expect(isDue(card, new Date(2026, 10, 11, 22, 0), H)).toBe(false);
  });
  it('holds a learning card to its exact due time', () => {
    const [base] = makeCards(omniNote(), NOW);
    const card = withSched(base, { state: 1, due: new Date(2026, 10, 12, 9, 10).toISOString() });
    expect(isDue(card, new Date(2026, 10, 12, 9, 0), H)).toBe(false);
    expect(isDue(card, new Date(2026, 10, 12, 9, 10), H)).toBe(true);
  });
  it('never counts a new card as due, and leaves out suspended and retired cards', () => {
    const [base] = makeCards(omniNote(), NOW);
    expect(isDue(base, NOW, H)).toBe(false);
    const due = withSched(base, { state: 2, due: NOW.toISOString() });
    expect(oneDeck([{ ...due, suspended: true }], { dayStartsAtHour: H, now: NOW }).due).toHaveLength(0);
    expect(oneDeck([{ ...due, retired: true }], { dayStartsAtHour: H, now: NOW }).due).toHaveLength(0);
    expect(oneDeck([{ ...base, retired: true }], { dayStartsAtHour: H, now: NOW }).fresh).toHaveLength(0);
  });
  it('says when the next learning card comes due', () => {
    const [base] = makeCards(omniNote(), NOW);
    const at = new Date(2026, 10, 11, 13, 0);
    expect(nextLearningDue([base], { dayStartsAtHour: H, now: NOW })).toBeUndefined();
    expect(nextLearningDue([withSched(base, { state: 1, due: at.toISOString() })], { dayStartsAtHour: H, now: NOW })).toEqual(at);
  });
  it("doesn't wait for a day-long learning step, which comes back on its own day", () => {
    const [base] = makeCards(omniNote(), NOW);
    // Answered this morning onto a one-day step: due tomorrow, Anki's queue 3.
    const interday = withSched(base, {
      state: 1, lastReview: new Date(2026, 10, 11, 9, 0).toISOString(), due: new Date(2026, 10, 12, 9, 0).toISOString(),
    });
    expect(nextLearningDue([interday], { dayStartsAtHour: H, now: NOW })).toBeUndefined();
    // One already due today but held back by the review limit doesn't leave the screen waiting either.
    const dueToday = withSched(base, {
      state: 1, lastReview: new Date(2026, 10, 10, 9, 0).toISOString(), due: new Date(2026, 10, 11, 9, 0).toISOString(),
    });
    expect(nextLearningDue([dueToday], { dayStartsAtHour: H, now: NOW })).toBeUndefined();
    // A step that runs past the day's end with no last answer recorded (imported) isn't waited for either.
    expect(nextLearningDue([withSched(base, { state: 1, due: new Date(2026, 10, 12, 5, 0).toISOString() })], { dayStartsAtHour: H, now: NOW })).toBeUndefined();
  });
});

describe('buried cards', () => {
  // NOW is 2026-11-11 12:00; that study day began at 4 AM.
  const today = new Date(2026, 10, 11, 9, 0).toISOString();
  const yesterday = new Date(2026, 10, 10, 22, 0).toISOString();

  it('holds back a card Anki buried today, and studies one buried on an earlier day', () => {
    const [base] = makeCards(omniNote(), NOW);
    const due = withSched(base, { state: 2, due: NOW.toISOString() });
    expect(isBuried({ ...due, buriedAt: today }, NOW, H)).toBe(true);
    expect(oneDeck([{ ...due, buriedAt: today }], { dayStartsAtHour: H, now: NOW }).due).toHaveLength(0);
    expect(oneDeck([{ ...base, buriedAt: today }], { dayStartsAtHour: H, now: NOW }).fresh).toHaveLength(0);
    expect(oneDeck([{ ...due, buriedAt: yesterday }], { dayStartsAtHour: H, now: NOW }).due).toHaveLength(1);
    // Buried at 1 AM belongs to the study day before, as Anki's day starts at 4.
    expect(isBuried({ ...due, buriedAt: new Date(2026, 10, 11, 1, 0).toISOString() }, NOW, H)).toBe(false);
  });

  it("doesn't wait for a buried learning card", () => {
    const [base] = makeCards(omniNote(), NOW);
    const learning = withSched(base, { state: 1, due: new Date(2026, 10, 11, 13, 0).toISOString() });
    expect(nextLearningDue([{ ...learning, buriedAt: today }], { dayStartsAtHour: H, now: NOW })).toBeUndefined();
  });
});

describe('burying siblings', () => {
  const all = { new: true, reviews: true, interdayLearning: true };
  const [base] = makeCards(omniNote(), NOW);
  const sib = (id: string, over: Partial<Card['sched']>, more: Partial<Card> = {}): Card => ({ ...withSched(base, over), id, ...more });
  const answered = sib('a', { state: 2, due: NOW.toISOString() });
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();
  const siblings = [
    sib('new', { state: 0 }),
    sib('reviewToday', { state: 2, due: at(11, 20) }),
    sib('reviewTomorrow', { state: 2, due: at(12, 9) }),
    // A learning step answered yesterday and due today: a day-long step. One due in ten minutes isn't.
    sib('interday', { state: 1, due: at(11, 9), lastReview: at(10, 9) }),
    sib('intraday', { state: 1, due: at(11, 12), lastReview: at(11, 11) }),
    sib('suspended', { state: 0 }, { suspended: true }),
    sib('otherNote', { state: 0 }, { noteId: 'elsewhere' }),
  ];
  const ids = (bury: Parameters<typeof siblingsToBury>[2]) =>
    siblingsToBury(answered, [answered, ...siblings], bury, NOW, H).map((c) => c.id);

  it("buries what the preset says, as Anki does: new, due reviews, and day-long learning steps", () => {
    expect(ids(all)).toEqual(['new', 'reviewToday', 'interday']);
    expect(ids({ new: true, reviews: false, interdayLearning: false })).toEqual(['new']);
    expect(ids({ new: false, reviews: true, interdayLearning: false })).toEqual(['reviewToday']);
  });

  it('buries nothing for a deck with no preset, or one burying nothing', () => {
    expect(ids(undefined)).toEqual([]);
    expect(ids({ new: false, reviews: false, interdayLearning: false })).toEqual([]);
  });

  it('leaves a sibling already buried today alone', () => {
    const already = sib('new', { state: 0 }, { buriedAt: at(11, 9) });
    expect(siblingsToBury(answered, [answered, already], all, NOW, H)).toEqual([]);
  });
});

describe("today's counts", () => {
  const note = omniNote();
  const deck = note.deck;
  const counts = (input: Partial<Parameters<typeof studiedToday>[0]>) =>
    studiedToday({ notes: [note], cards: [], reviews: [], revlog: [], now: NOW, dayStartsAtHour: H, ...input });

  it("counts a Franki-only card's first answer as introduced, and answers in Review as reviews", () => {
    const [card] = makeCards(note, NOW);
    const learned = review(review(card.sched, 3, NOW).sched, 3, NOW).sched; // now in Review
    const reviews = [
      { cardId: card.id, ...review(card.sched, 3, NOW).log },
      { cardId: card.id, ...review(learned, 3, NOW).log },
      { cardId: card.id, ...review(learned, 1, NOW).log },
    ];
    expect(counts({ cards: [card], reviews }).get(deck)).toEqual({ introduced: 1, reviewed: 2 });
  });

  it('counts a 1 AM session against the study day before it', () => {
    const [card] = makeCards(note, NOW);
    const reviews = [{ cardId: card.id, ...review(card.sched, 3, new Date(2026, 10, 12, 1, 0)).log }];
    expect(counts({ cards: [card], reviews, now: new Date(2026, 10, 11, 20, 0) }).get(deck)?.introduced).toBe(1);
    expect(counts({ cards: [card], reviews, now: new Date(2026, 10, 12, 9, 0) }).get(deck)).toBeUndefined();
  });

  it("counts an Anki card's answers from Anki's review log, given here or on another device, once", () => {
    const [base] = makeCards(note, NOW);
    const fresh = { ...base, ankiId: '100' };
    const reviewing = { ...base, id: `${base.id}-b`, ankiId: '101' };
    const at = (h: number) => new Date(2026, 10, 11, h, 0).getTime();
    const revlog = [
      // A new card's first answer (lastIvl 0), then its next learning step: one card introduced.
      { id: at(8), cid: 100, ease: 3, lastIvl: 0, time: 5000, type: 0 },
      { id: at(8) + 600_000, cid: 100, ease: 3, lastIvl: -600, time: 4000, type: 0 },
      // Reviews, one of them in a filtered deck (type 3).
      { id: at(9), cid: 101, ease: 3, lastIvl: 12, time: 3000, type: 1 },
      { id: at(10), cid: 101, ease: 1, lastIvl: 30, time: 3000, type: 3 },
      // An answer to a learning card on a day-long step (its last interval in days) counts as a review.
      { id: at(10) + 1, cid: 100, ease: 3, lastIvl: 1, time: 3000, type: 0 },
      // Yesterday's, and a manual reschedule (ease 0): neither counts.
      { id: new Date(2026, 10, 10, 20, 0).getTime(), cid: 101, ease: 3, lastIvl: 5, time: 3000, type: 1 },
      { id: at(11), cid: 101, ease: 0, lastIvl: 30, time: 0, type: 4 },
    ];
    // Franki's own answer to an Anki card is in the review log too (write-back), so its row in
    // Franki's table isn't counted again.
    const reviews = [{ cardId: fresh.id, ...review(fresh.sched, 3, NOW).log }];
    expect(counts({ cards: [fresh, reviewing], revlog, reviews }).get(deck)).toEqual({ introduced: 1, reviewed: 3 });
  });
});
