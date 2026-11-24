import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../../src/core/config';
import { currentLimits, DEFAULT_PASS_RATE, forecast, forecastRoots, limitDecks, passRate, type ForecastInput } from '../../src/core/forecast';
import type { Answer } from '../../src/core/stats';
import type { Card, DeckParams, Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const DAYS = 30;
let n = 0;

function notesIn(deck: string, count: number): Note[] {
  return Array.from({ length: count }, () => ({ ...omniNote(), id: `f${n++}`, deck }));
}
function newCardsOf(notes: Note[]): Card[] {
  return notes.flatMap((note) => makeCards(note, NOW).filter((c) => c.kind === 'forward'));
}
/** Review cards that fall due on the given study day (an offset from NOW's study day), with a few days of stability behind them. */
function reviewsDue(notes: Note[], dayOffset: number): Card[] {
  return newCardsOf(notes).map((c) => ({
    ...c,
    sched: { ...c.sched, state: 2, due: new Date(2026, 10, 11 + dayOffset, 12).toISOString(), stability: 3, difficulty: 5, scheduledDays: 3, reps: 5, lastReview: new Date(2026, 9, 20, 12).toISOString() },
  }));
}
function inputFor(notes: Note[], cards: Card[], over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    notes, cards, params: new Map(), collection: { ...DEFAULT_COLLECTION_SETTINGS, dayStartsAtHour: H }, studied: new Map(), settings: new Map(),
    roots: forecastRoots(null, notes.map((x) => x.deck)), passRate: 0.9, now: NOW, days: DAYS, ...over,
  };
}
const total = (f: ReturnType<typeof forecast>, key: 'scheduled' | 'expected') => f.days.reduce((s, d) => s + d[key], 0);

describe('forecast', () => {
  it('counts a card already due as scheduled, and its next review inside the window as expected', () => {
    const notes = notesIn('Polski', 10);
    const f = forecast(inputFor(notes, reviewsDue(notes, 2)));
    expect(f.days[2].scheduled).toBe(10);
    expect(f.days[0].scheduled + f.days[1].scheduled).toBe(0);
    // A card passed on day 2 with a few days of stability comes back again before day 30, which the old chart never showed.
    expect(total(f, 'scheduled')).toBe(10);
    expect(total(f, 'expected')).toBeGreaterThan(0);
  });

  it('starts new cards up to the daily limit, and each one brings reviews of its own', () => {
    const notes = notesIn('Polski', 200);
    const settings = new Map([['Polski', { newPerDay: 5, reviewsPerDay: 200 }]]);
    const f = forecast(inputFor(notes, newCardsOf(notes), { settings }));
    expect(f.newStarted).toBe(5 * DAYS);
    expect(f.days[0].expected).toBe(5);
    expect(f.days[10].expected).toBeGreaterThan(5);
    expect(total(f, 'scheduled')).toBe(0);
  });

  it('stops at the cards a deck has: no more new cards than exist', () => {
    const notes = notesIn('Polski', 12);
    const settings = new Map([['Polski', { newPerDay: 5, reviewsPerDay: 200 }]]);
    expect(forecast(inputFor(notes, newCardsOf(notes), { settings })).newStarted).toBe(12);
  });

  it('takes a what-if limit in place of the deck’s own, and only for that deck', () => {
    const polski = notesIn('Polski', 200);
    const thai = notesIn('Thai', 200);
    const notes = [...polski, ...thai];
    const settings = new Map([['Polski', { newPerDay: 5, reviewsPerDay: 200 }], ['Thai', { newPerDay: 5, reviewsPerDay: 200 }]]);
    const base = forecast(inputFor(notes, newCardsOf(notes), { settings }));
    const trial = forecast(inputFor(notes, newCardsOf(notes), { settings, limits: new Map([['Polski', { newPerDay: 0 }]]) }));
    expect(base.newStarted).toBe(10 * DAYS);
    expect(trial.newStarted).toBe(5 * DAYS);
    expect(trial.days[0].expected).toBe(5);
  });

  it('keeps reviews the limit holds back for a later day, and reports what is still waiting', () => {
    const notes = notesIn('Polski', 60);
    const cards = reviewsDue(notes, 0);
    const settings = new Map([['Polski', { newPerDay: 0, reviewsPerDay: 20 }]]);
    const f = forecast(inputFor(notes, cards, { settings }));
    // 60 reviews due today at 20 a day: the limit fills each of the first three days, the rest waiting. Cards already
    // studied come back and share the room, so the days hold 20 in all, not 20 scheduled.
    expect(f.days.slice(0, 3).map((d) => d.scheduled + d.expected)).toEqual([20, 20, 20]);
    expect(f.days[0].scheduled).toBe(20);
    const roomy = forecast(inputFor(notes, cards, { settings: new Map([['Polski', { newPerDay: 0, reviewsPerDay: 500 }]]) }));
    expect(roomy.days[0].scheduled).toBe(60);
    expect(roomy.waiting).toBe(0);
    const tight = forecast(inputFor(notes, newCardsOf(notesIn('Polski', 400)).concat(cards), { settings: new Map([['Polski', { newPerDay: 0, reviewsPerDay: 1 }]]) }));
    expect(tight.waiting).toBeGreaterThan(0);
  });

  it('counts what was already studied today against today’s limit, but not tomorrow’s', () => {
    const notes = notesIn('Polski', 30);
    const settings = new Map([['Polski', { newPerDay: 0, reviewsPerDay: 20 }]]);
    const f = forecast(inputFor(notes, reviewsDue(notes, 0), { settings, studied: new Map([['Polski', { introduced: 0, reviewed: 15 }]]) }));
    expect(f.days[0].scheduled).toBe(5);
    expect(f.days[1].scheduled).toBe(20);
  });

  it('draws the same chart every time, and fewer reviews when more are failed', () => {
    const notes = notesIn('Polski', 40);
    const cards = reviewsDue(notes, 1);
    const a = forecast(inputFor(notes, cards));
    expect(forecast(inputFor(notes, cards))).toEqual(a);
    const worse = forecast(inputFor(notes, cards, { passRate: 0.5 }));
    expect(total(worse, 'expected')).toBeGreaterThan(total(a, 'expected'));
  });

  it('does not change the cards it was given', () => {
    const notes = notesIn('Polski', 5);
    const cards = reviewsDue(notes, 0);
    const before = JSON.stringify(cards);
    forecast(inputFor(notes, cards));
    expect(JSON.stringify(cards)).toBe(before);
  });

  it('leaves out suspended cards', () => {
    const notes = notesIn('Polski', 5);
    const cards = reviewsDue(notes, 0).map((c) => ({ ...c, suspended: true }));
    const f = forecast(inputFor(notes, cards));
    expect(total(f, 'scheduled') + total(f, 'expected')).toBe(0);
  });
});

describe('what each day\u2019s queue and answers take into account', () => {
  const preset = (over: Partial<DeckParams> = {}): DeckParams => ({ weights: [], desiredRetention: 0.9, maxInterval: 36500, presetId: 1, ...over });
  const twoCards = (notes: Note[]) => newCardsOf(notes).flatMap((c) => [c, { ...c, id: `${c.id}r`, kind: 'reverse' as const }]);
  const due = (cards: Card[]) => cards.map((c) => ({ ...c, sched: { ...c.sched, state: 2, due: new Date(2026, 10, 11, 9).toISOString(), stability: 10, difficulty: 5, scheduledDays: 10, reps: 5, lastReview: new Date(2026, 10, 1, 12).toISOString() } }));

  it('studies only one card of a note on a day when its preset buries review siblings', () => {
    const notes = notesIn('Polski', 10);
    const cards = due(twoCards(notes));
    expect(new Set(cards.map((c) => c.kind)).size).toBe(2);
    const buried = forecast(inputFor(notes, cards, { params: new Map([['Polski', preset({ bury: { new: false, reviews: true, interdayLearning: false } })]]) }));
    const free = forecast(inputFor(notes, cards, { params: new Map([['Polski', preset()]]) }));
    expect(free.days[0].scheduled).toBe(20);
    expect(buried.days[0].scheduled).toBe(10);
    // The held siblings are studied the next day.
    expect(buried.days[1].scheduled).toBe(10);
  });

  it('leaves out the cards today\u2019s lookalike hold keeps back, on today only', () => {
    const notes = notesIn('Polski', 10);
    const cards = due(newCardsOf(notes));
    const held = new Set(cards.slice(0, 4).map((c) => c.id));
    const f = forecast(inputFor(notes, cards, { held }));
    expect(f.days[0].scheduled).toBe(6);
    expect(f.days[1].scheduled).toBe(4);
  });

  it('places answers with the load balancer unless the collection turns it off', () => {
    const notes = notesIn('Polski', 150);
    const cards = due(newCardsOf(notes));
    const params = new Map([['Polski', preset()]]);
    const on = forecast(inputFor(notes, cards, { params }));
    const off = forecast(inputFor(notes, cards, { params, collection: { ...DEFAULT_COLLECTION_SETTINGS, dayStartsAtHour: H, loadBalancer: false } }));
    expect(on.days.map((d) => d.expected)).not.toEqual(off.days.map((d) => d.expected));
    expect(forecast(inputFor(notes, cards, { params }))).toEqual(on);
  });
});

describe('passRate', () => {
  const answer = (rating: 1 | 3, over: Partial<Answer> = {}): Answer => ({ cardId: 'c', at: new Date(2026, 10, 10, 12), rating, kind: 'review', wasNew: false, takenMs: 0, ...over });
  it('is the share of the last 30 days’ reviews that were not Again', () => {
    const answers = [...Array(80).fill(0).map(() => answer(3)), ...Array(20).fill(0).map(() => answer(1))];
    expect(passRate(answers, NOW, H)).toBeCloseTo(0.8);
  });
  it('ignores new cards, learning steps, previews and answers older than 30 days', () => {
    const answers = [
      ...Array(40).fill(0).map(() => answer(3)),
      ...Array(50).fill(0).map(() => answer(1, { wasNew: true })),
      ...Array(50).fill(0).map(() => answer(1, { kind: 'learn' })),
      ...Array(50).fill(0).map(() => answer(1, { preview: true })),
      ...Array(50).fill(0).map(() => answer(1, { at: new Date(2026, 8, 1, 12) })),
    ];
    expect(passRate(answers, NOW, H)).toBe(1);
  });
  it('falls back to the default with too little to go on', () => {
    expect(passRate([answer(1), answer(1)], NOW, H)).toBe(DEFAULT_PASS_RATE);
  });
});

describe('which decks are offered', () => {
  const decks = ['Polski::Odmiana', 'Polski::Slowa', 'Thai', 'Thai::Food::Fruit'];
  it('studies each top-level deck for the whole collection, and the deck chosen otherwise', () => {
    expect(forecastRoots(null, decks)).toEqual(['Polski', 'Thai']);
    expect(forecastRoots('Polski::Odmiana', decks)).toEqual(['Polski::Odmiana']);
  });
  it('offers limits for the top-level decks, or the scope and the decks directly under it', () => {
    expect(limitDecks(null, decks)).toEqual(['Polski', 'Thai']);
    expect(limitDecks('Thai', decks)).toEqual(['Thai', 'Thai::Food']);
    expect(limitDecks('Polski::Odmiana', decks)).toEqual(['Polski::Odmiana']);
  });
});

describe('currentLimits', () => {
  it('reads a deck’s limits the way the queue does', () => {
    const notes = notesIn('Polski', 1);
    const input = inputFor(notes, newCardsOf(notes), { settings: new Map([['Polski', { newPerDay: 7, reviewsPerDay: 90 }]]) });
    expect(currentLimits(input, 'Polski')).toEqual({ newPerDay: 7, reviewsPerDay: 90 });
  });
});
