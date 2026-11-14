import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../../src/core/config';
import { queueInput, treeQueue } from '../../src/core/deckTree';
import type { Card, DeckParams } from '../../src/core/types';
import {
  activeMode, addDays, chooseLength, chooseMode, DEFAULT_VACATION, parseVacation, scaleLimits, vacationNotice, vacationPlan,
  type VacationPrefs,
} from '../../src/core/vacation';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const TODAY = '2026-11-11';
const DECK = 'Thai';
let n = 0;

const note = () => ({ ...omniNote({ Entry: `w${n}` }), id: `n${n++}`, deck: DECK });
/** A review card that came due on `day` of November, noon. */
function review(day: number, deck = DECK): { note: ReturnType<typeof note>; card: Card } {
  const nt = { ...note(), deck };
  const card = makeCards(nt, NOW)[0];
  return { note: nt, card: { ...card, sched: { ...card.sched, state: 2, due: new Date(2026, 10, day, 12).toISOString() } } };
}
const fresh = () => { const nt = note(); return { note: nt, card: makeCards(nt, NOW)[0] }; };

const light: VacationPrefs = { ...DEFAULT_VACATION, mode: 'light', from: '2026-11-01', until: '2026-11-15' };
const params = (over: Partial<DeckParams> = {}): Map<string, DeckParams> =>
  new Map([[DECK, { weights: [], desiredRetention: 0.9, maxInterval: 36500, newPerDay: 20, reviewsPerDay: 200, ...over }]]);

function queueFor(items: { note: { id: string; deck: string }; card: Card }[], vacation: VacationPrefs | undefined, p = params()) {
  const input = queueInput({
    notes: items.map((i) => i.note) as never, cards: items.map((i) => i.card), params: p, studied: new Map(),
    // New cards don't use review room here, so a test of the review cut doesn't also cut the new cards.
    collection: { ...DEFAULT_COLLECTION_SETTINGS, newCardsIgnoreReviewLimit: true }, now: NOW, vacation,
  });
  return treeQueue(DECK, input);
}

describe('the vacation setting', () => {
  it('is off until turned on, and falls back to the default for anything unreadable', () => {
    expect(parseVacation(null)).toEqual(DEFAULT_VACATION);
    expect(DEFAULT_VACATION.mode).toBe('off');
    expect(parseVacation('not json')).toEqual(DEFAULT_VACATION);
    expect(parseVacation(JSON.stringify({ mode: 'light', newPerDeck: 2, reviewPercent: 25, length: 7, from: '2026-11-01', until: '2026-11-08' })))
      .toEqual({ mode: 'light', newPerDeck: 2, reviewPercent: 25, length: 7, from: '2026-11-01', until: '2026-11-08' });
    expect(parseVacation(JSON.stringify({ mode: 'sleep', newPerDeck: 99, reviewPercent: 3, length: 4, until: 'soon' }))).toEqual(DEFAULT_VACATION);
  });

  it('applies until the end date, which is the first day back to normal', () => {
    expect(activeMode(light, '2026-11-14')).toBe('light');
    expect(activeMode(light, '2026-11-15')).toBe('off');
    expect(activeMode({ ...light, until: undefined }, '2030-01-01')).toBe('light');
    expect(activeMode({ ...light, mode: 'off' }, '2026-11-12')).toBe('off');
  });

  it('starts today and ends after the chosen length, or never', () => {
    const on = chooseMode(DEFAULT_VACATION, 'light', TODAY);
    expect(on).toMatchObject({ mode: 'light', from: TODAY, until: '2026-11-25' });
    expect(chooseMode({ ...DEFAULT_VACATION, length: 0 }, 'paused', TODAY)).toEqual({ ...DEFAULT_VACATION, length: 0, mode: 'paused', from: TODAY });
    // Switching level mid-vacation keeps its dates.
    expect(chooseMode(on, 'paused', '2026-11-13')).toEqual({ ...on, mode: 'paused' });
    // A new length counts from today.
    expect(chooseLength(on, 7, '2026-11-13').until).toBe('2026-11-20');
    expect(chooseLength(on, 0, '2026-11-13').until).toBeUndefined();
    // Not on: the length is only remembered.
    expect(chooseLength(DEFAULT_VACATION, 7, TODAY)).toEqual({ ...DEFAULT_VACATION, length: 7 });
  });

  it('ending by hand ends it today, so the catch-up still applies', () => {
    const off = chooseMode(chooseMode(DEFAULT_VACATION, 'light', '2026-11-01'), 'off', TODAY);
    expect(off).toMatchObject({ mode: 'off', from: '2026-11-01', until: TODAY });
    expect(vacationPlan(off, [review(2).card], NOW, H)).toMatchObject({ weakestFirst: true });
    // Off before any vacation is just off.
    expect(chooseMode(DEFAULT_VACATION, 'off', TODAY)).toEqual(DEFAULT_VACATION);
  });

  it('adds days by the calendar across a month end', () => {
    expect(addDays('2026-11-28', 5)).toBe('2026-12-03');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('what a plan does to limits', () => {
  const base = { newPerDay: 20, reviewsPerDay: 200 };
  const plan = { paused: false, newPerDeck: 1, reviewShare: 0.5, weakestFirst: true };
  it('cuts new cards to the count and reviews to the share, never raising a limit', () => {
    expect(scaleLimits(base, plan, { new: false, review: false })).toEqual({ newPerDay: 1, reviewsPerDay: 100 });
    expect(scaleLimits({ newPerDay: 0, reviewsPerDay: 1 }, plan, { new: false, review: false })).toEqual({ newPerDay: 0, reviewsPerDay: 1 });
    expect(scaleLimits({ newPerDay: 20, reviewsPerDay: 5 }, { ...plan, reviewShare: 0.1 }, { new: false, review: false }).reviewsPerDay).toBe(1);
  });
  it("leaves a limit alone that Custom Study set for today, and does nothing without a plan", () => {
    expect(scaleLimits(base, plan, { new: true, review: true })).toEqual(base);
    expect(scaleLimits(base, undefined, { new: false, review: false })).toBe(base);
    expect(scaleLimits(base, { paused: false, weakestFirst: true }, { new: false, review: false })).toEqual(base);
  });
});

describe('the plan from the setting and the cards', () => {
  it('is light or paused while it applies', () => {
    expect(vacationPlan(light, [], NOW, H)).toEqual({ paused: false, newPerDeck: 1, reviewShare: 0.5, weakestFirst: true });
    expect(vacationPlan({ ...light, mode: 'paused' }, [], NOW, H)).toEqual({ paused: true, weakestFirst: true });
    expect(vacationPlan(undefined, [], NOW, H)).toBeUndefined();
  });

  it('keeps the weakest-first order after the end while a review from before it still waits', () => {
    const over = { ...light, until: '2026-11-10' };
    expect(vacationPlan(over, [review(8).card], NOW, H)).toEqual({ paused: false, weakestFirst: true });
    // Nothing left from before the end (this one came due the day it ended): the deck's own order is back.
    expect(vacationPlan(over, [review(10).card, review(11).card, fresh().card], NOW, H)).toBeUndefined();
    // A suspended card isn't a backlog.
    expect(vacationPlan(over, [{ ...review(8).card, suspended: true }], NOW, H)).toBeUndefined();
  });

  it('stops after the catch-up window, whatever is left', () => {
    expect(vacationPlan({ ...light, until: '2026-10-28' }, [review(-8).card], NOW, H)).toBeDefined();
    expect(vacationPlan({ ...light, until: '2026-10-27' }, [review(-8).card], NOW, H)).toBeUndefined();
  });

  it('counts the study day, so 1 AM still belongs to the day before', () => {
    const early = new Date(2026, 10, 15, 1);
    expect(vacationPlan(light, [], early, H)?.reviewShare).toBe(0.5);
    expect(vacationPlan(light, [], new Date(2026, 10, 15, 5), H)).toBeUndefined();
  });
});

describe('a deck under vacation mode', () => {
  it('offers one new card and half the reviews, weakest first', () => {
    const items = [...Array.from({ length: 12 }, (_, i) => review(1 + (i % 10))), ...Array.from({ length: 5 }, fresh)];
    const normal = queueFor(items, undefined, params({ reviewsPerDay: 12 }));
    expect(normal.due).toHaveLength(12);
    expect(normal.fresh).toHaveLength(5);
    const q = queueFor(items, light, params({ reviewsPerDay: 12 }));
    expect(q.due).toHaveLength(6);
    expect(q.fresh).toHaveLength(1);
  });

  it('puts the most overdue first, not the oldest due date', () => {
    // Same due day, but one has a far longer interval, so it is less overdue relative to it.
    const long = review(9);
    long.card = { ...long.card, sched: { ...long.card.sched, scheduledDays: 300, stability: 300, lastReview: new Date(2025, 0, 1).toISOString() } };
    const short = review(10);
    short.card = { ...short.card, sched: { ...short.card.sched, scheduledDays: 2, stability: 2, lastReview: new Date(2026, 10, 8).toISOString() } };
    const q = queueFor([long, short], light, params({ reviewsPerDay: 1 }));
    expect(q.due.map((c) => c.id)).toEqual([short.card.id]);
  });

  it('shows nothing while paused, but a Custom Study limit still stands under Light', () => {
    const items = [review(5), review(6), ...Array.from({ length: 4 }, fresh)];
    expect(queueFor(items, { ...light, mode: 'paused' }).order).toEqual([]);
    const today = { day: TODAY, limit: 3 };
    expect(queueFor(items, light, params({ newLimitToday: today })).fresh).toHaveLength(3);
  });

  it('leaves everything as it was once it ends and nothing is waiting', () => {
    const items = [review(10), review(11), fresh()];
    const q = queueFor(items, { ...light, until: '2026-11-10' });
    expect(q.due).toHaveLength(2);
    expect(q.fresh).toHaveLength(1);
  });
});

describe('what the deck list says', () => {
  it('names the level and the end date while it applies', () => {
    expect(vacationNotice(light, NOW, H)).toEqual({ kind: 'away', mode: 'light', until: '2026-11-15' });
    expect(vacationNotice({ ...light, mode: 'paused', until: undefined }, NOW, H)).toEqual({ kind: 'away', mode: 'paused', until: undefined });
    expect(vacationNotice(DEFAULT_VACATION, NOW, H)).toBeUndefined();
  });

  it('welcomes you back for two days, with how long you were away', () => {
    const ended = { ...light, from: '2026-10-27', until: '2026-11-10' };
    expect(vacationNotice(ended, NOW, H)).toEqual({ kind: 'back', days: 14 });
    expect(vacationNotice({ ...ended, until: '2026-11-09' }, NOW, H)).toEqual({ kind: 'back', days: 13 });
    expect(vacationNotice({ ...ended, until: '2026-11-08' }, NOW, H)).toBeUndefined();
  });
});
