import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../../src/core/config';
import { GOAL_DAYS, goalTarget, MAX_DAILY_GOAL, parseDailyGoal, tune, tunedToday, goalTurnedOff, withTuning, type GoalInput, type GoalResult } from '../../src/core/dailyGoal';
import { forecast } from '../../src/core/forecast';
import type { Card, DeckParams, DeckSettings, Note } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
let n = 0;

function notesIn(deck: string, count: number): Note[] {
  return Array.from({ length: count }, () => ({ ...omniNote(), id: `g${n++}`, deck }));
}
function newCardsOf(notes: Note[]): Card[] {
  return notes.flatMap((note) => makeCards(note, NOW).filter((c) => c.kind === 'forward'));
}
/** Review cards due on NOW's study day, with a few days of stability behind them. */
function reviewsDueToday(notes: Note[]): Card[] {
  return newCardsOf(notes).map((c) => ({
    ...c,
    sched: { ...c.sched, state: 2, due: new Date(2026, 10, 11, 12).toISOString(), stability: 3, difficulty: 5, scheduledDays: 3, reps: 5, lastReview: new Date(2026, 10, 8, 12).toISOString() },
  }));
}
function inputFor(deck: string, goal: number, notes: Note[], cards: Card[], settings: Map<string, DeckSettings>): GoalInput {
  return {
    deck, goal, notes, cards, params: new Map(), collection: { ...DEFAULT_COLLECTION_SETTINGS, dayStartsAtHour: H },
    studied: new Map(), settings, now: NOW, answers: [],
  };
}
const peak = (loads: number[]) => Math.max(...loads);
/** The day loads the forecast gives the deck at a new card limit, as the search plays them. */
function loadsAtNewLimit(i: GoalInput, newPerDay: number): number[] {
  const f = forecast({ ...i, roots: [i.deck], passRate: 0.9, days: GOAL_DAYS, limits: new Map([[i.deck, { newPerDay }]]) });
  return f.days.map((d) => d.scheduled + d.expected);
}

describe('tune', () => {
  it('finds the most new cards a day that keep every day at or under the goal', () => {
    const notes = notesIn('Polski', 400);
    const input = inputFor('Polski', 40, notes, newCardsOf(notes), new Map([['Polski', { newPerDay: 10, reviewsPerDay: 9999 }]]));
    const r = tune(input);
    expect(r.lever).toBe('new');
    expect(r.over).toBe(false);
    expect(r.value).toBeGreaterThan(0);
    expect(r.loads).toHaveLength(GOAL_DAYS);
    expect(peak(r.loads)).toBeLessThanOrEqual(40);
    expect(r.loads).toEqual(loadsAtNewLimit(input, r.value));
    // One more a day goes over on some day: the value is the most that fits, not just one that does.
    expect(peak(loadsAtNewLimit(input, r.value + 1))).toBeGreaterThan(40);
    expect(r.newToday).toBe(r.value);
  });

  it('turns new cards off when the reviews already scheduled go over the goal, and never limits reviews', () => {
    const notes = notesIn('Polski', 60);
    const fresh = notesIn('Polski', 50);
    const input = inputFor('Polski', 20, [...notes, ...fresh], [...reviewsDueToday(notes), ...newCardsOf(fresh)], new Map([['Polski', { newPerDay: 10, reviewsPerDay: 9999 }]]));
    const r = tune(input);
    expect(r).toMatchObject({ lever: 'new', value: 0, newToday: 0, over: true });
    expect(r.loads[0]).toBe(60);
  });

  it('sets a gated deck’s cap rather than its new card limit', () => {
    const notes = notesIn('Ελληνικά', 300);
    const settings = new Map<string, DeckSettings>([['Ελληνικά', { gateCap: 10, newPerDay: 10, reviewsPerDay: 9999 }]]);
    const r = tune(inputFor('Ελληνικά', 25, notes, newCardsOf(notes), settings));
    expect(r.lever).toBe('gate');
    expect(r.over).toBe(false);
    expect(r.value).toBeGreaterThanOrEqual(1);
    expect(peak(r.loads)).toBeLessThanOrEqual(25);
    // The cap found plays as the gate would: the same loads come back from the forecast with that cap.
    const f = forecast({
      ...inputFor('Ελληνικά', 25, notes, newCardsOf(notes), new Map([['Ελληνικά', { ...settings.get('Ελληνικά'), gateCap: r.value }]])),
      roots: ['Ελληνικά'], passRate: 0.9, days: GOAL_DAYS,
    });
    expect(f.days.map((d) => d.scheduled + d.expected)).toEqual(r.loads);
  });

  it('counts only the deck’s own cards', () => {
    const polski = notesIn('Polski', 200);
    const thai = notesIn('Thai', 80);
    const settings = new Map([['Polski', { newPerDay: 10, reviewsPerDay: 9999 }], ['Thai', { newPerDay: 0, reviewsPerDay: 9999 }]]);
    const alone = tune(inputFor('Polski', 30, polski, newCardsOf(polski), settings));
    const beside = tune(inputFor('Polski', 30, [...polski, ...thai], [...newCardsOf(polski), ...reviewsDueToday(thai)], settings));
    expect(beside.value).toBe(alone.value);
    expect(beside.loads).toEqual(alone.loads);
  });

  it('offers no more new cards a day than the goal, or than the deck has', () => {
    const notes = notesIn('Polski', 3);
    const r = tune(inputFor('Polski', 500, notes, newCardsOf(notes), new Map([['Polski', { newPerDay: 10, reviewsPerDay: 9999 }]])));
    expect(r.value).toBe(3);
  });
});

describe('parseDailyGoal', () => {
  it('takes a whole number in range and refuses anything else with the reason', () => {
    expect(parseDailyGoal(' 120 ')).toEqual({ goal: 120 });
    for (const bad of ['', '0', '-5', '12.5', 'abc', String(MAX_DAILY_GOAL + 1)]) {
      expect(parseDailyGoal(bad)).toEqual({ error: `Enter a whole number from 1 to ${MAX_DAILY_GOAL}.` });
    }
  });
});

describe('tunedToday and withTuning', () => {
  const result = (over: Partial<GoalResult> = {}): GoalResult =>
    ({ day: '2026-11-11', goal: 50, lever: 'new', value: 6, newToday: 6, loads: [40], over: false, ...over });

  it('is current only on the study day it was worked out, for the goal the deck has now', () => {
    const s: DeckSettings = { dailyGoal: 50, goalTuned: result() };
    expect(tunedToday(s, NOW, H)).toBe(true);
    expect(tunedToday({ ...s, dailyGoal: 60 }, NOW, H)).toBe(false);
    expect(tunedToday(s, new Date(2026, 10, 12, 12), H)).toBe(false);
    // 2 AM on the 12th is still the 11th's study day.
    expect(tunedToday(s, new Date(2026, 10, 12, 2), H)).toBe(true);
    expect(tunedToday({ dailyGoal: 50 }, NOW, H)).toBe(false);
  });

  it('sets a gate’s cap, a preset-less deck’s own new limit, and leaves an Anki deck’s limit to the collection', () => {
    expect(withTuning({ gateCap: 10 }, result({ lever: 'gate', value: 45 }), 'gate', 10)).toMatchObject({ gateCap: 45 });
    expect(withTuning({ newPerDay: 10 }, result(), 'own', 10)).toMatchObject({ newPerDay: 6 });
    expect(withTuning({ newPerDay: 10 }, result(), 'anki', null)).toEqual({ newPerDay: 10, goalTuned: result(), goalReplaced: null });
  });

  it('keeps the value the first tuning replaced and puts it back when the goal is turned off', () => {
    const first = withTuning({ gateCap: 10, dailyGoal: 50 }, result({ lever: 'gate', value: 45 }), 'gate', 10);
    const second = withTuning(first, result({ lever: 'gate', value: 0, over: true }), 'gate', 45);
    expect(second.goalReplaced).toBe(10);
    expect(goalTurnedOff(second, 'gate')).toEqual({ settings: { gateCap: 10, dailyGoal: undefined, goalTuned: undefined } });
    // A preset-less deck that had no limit of its own goes back to none; an Anki deck's is put back in the collection.
    const own = withTuning({ dailyGoal: 50 }, result({ value: 0 }), 'own', null);
    expect(goalTurnedOff(own, 'own').settings.newPerDay).toBeUndefined();
    expect(goalTurnedOff(withTuning({ dailyGoal: 50 }, result(), 'anki', 8), 'anki').ankiLimit).toBe(8);
    expect(goalTurnedOff(withTuning({ dailyGoal: 50 }, result(), 'anki', null), 'anki').ankiLimit).toBeNull();
    // Never tuned: nothing is put back.
    expect(goalTurnedOff({ dailyGoal: 50, newPerDay: 4 }, 'own')).toEqual({ settings: { newPerDay: 4, dailyGoal: undefined, goalTuned: undefined } });
  });
});

describe('goalTarget', () => {
  const anki = { presetId: 1, newPerDay: 10, reviewsPerDay: 200 } as DeckParams;
  const params = new Map<string, DeckParams>([['Polski', anki], ['Filtered', { filtered: { reschedule: true, previewSecs: { again: 0, hard: 0, good: 0 } } } as DeckParams]]);

  it('names what the goal sets for each kind of deck, and nothing where it can set nothing', () => {
    expect(goalTarget('Polski', { gateCap: 10 }, params)).toBe('gate');
    expect(goalTarget('Polski', {}, params)).toBe('anki');
    expect(goalTarget('Mine', undefined, params)).toBe('own');
    expect(goalTarget('Polski::Made here', undefined, params)).toBeUndefined();
    expect(goalTarget('Filtered', { gateCap: 10 }, params)).toBeUndefined();
  });
});
