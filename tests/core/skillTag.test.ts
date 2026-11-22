import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { isSettled } from '../../src/core/progress';
import { review } from '../../src/core/scheduler';
import { answerParams, DRILL_MAX_INTERVAL_DAYS, drillDueTooFar, isDrillNote, setAsideOf } from '../../src/core/skillTag';
import type { DeckParams } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const DRILL = { tags: ['skill', 'skill::drill::dates-day', 'skill::lang::pl'] };
const CONSONANT = { tags: ['skill', 'skill::consonants', 'skill::lang::th'] };
const PRESET: DeckParams = { weights: [], desiredRetention: 0.9, maxInterval: 36500 };

describe('a drill card is answered with a week as its longest interval', () => {
  it('caps a drill card only, and keeps the rest of its preset', () => {
    expect(answerParams(PRESET, DRILL)).toEqual({ ...PRESET, maxInterval: DRILL_MAX_INTERVAL_DAYS });
    // One fixed fact (a consonant's class) is scheduled as any card; so is a word, and a card with no note yet.
    expect(answerParams(PRESET, CONSONANT)).toBe(PRESET);
    expect(answerParams(PRESET, { tags: ['skill::words'] })).toBe(PRESET);
    expect(answerParams(PRESET, undefined)).toBe(PRESET);
    // A shorter maximum of the preset's own stays, and a deck with no preset still gets the cap.
    const short = { ...PRESET, maxInterval: 3 };
    expect(answerParams(short, DRILL)).toBe(short);
    expect(answerParams(undefined, DRILL)?.maxInterval).toBe(DRILL_MAX_INTERVAL_DAYS);
  });

  it("brings a mature drill card back within the week, and that still counts as settled for the ladder", () => {
    const [card] = makeCards(omniNote(), NOW);
    const sched = { ...card.sched, state: 2, stability: 200, difficulty: 5, reps: 8, scheduledDays: 120, lastReview: new Date(2026, 6, 14, 12).toISOString() };
    expect(review(sched, 3, NOW, PRESET).sched.scheduledDays).toBeGreaterThan(30);
    const capped = review(sched, 4, NOW, answerParams(PRESET, DRILL)).sched;
    expect(capped.scheduledDays).toBe(DRILL_MAX_INTERVAL_DAYS);
    // The next step opens once this one is settled (a week or more out): a cap any shorter would stop the ladder.
    expect(isSettled({ sched: capped })).toBe(true);
  });

  it('tells a drill note from the other skill notes', () => {
    expect(isDrillNote(DRILL)).toBe(true);
    expect(isDrillNote(CONSONANT)).toBe(false);
    expect(isDrillNote({ tags: ['skill::drill::dates-day'] })).toBe(false);
  });
});

describe('a drill card due further out than the week', () => {
  const [card] = makeCards(omniNote(), NOW);
  const due = (d: Date, over = {}) => ({ ...card, sched: { ...card.sched, state: 2, due: d.toISOString() }, ...over });

  it('is one due past the seventh study day from today, counted by study days', () => {
    // NOW is noon on 11 November; the day starts at 4 AM, so the 18th before 4 AM is still the 17th's.
    expect(drillDueTooFar(due(new Date(2026, 10, 18, 12)), NOW, 4)).toBe(false);
    expect(drillDueTooFar(due(new Date(2026, 10, 19, 3)), NOW, 4)).toBe(false);
    expect(drillDueTooFar(due(new Date(2026, 10, 19, 12)), NOW, 4)).toBe(true);
    expect(drillDueTooFar(due(new Date(2027, 8, 1, 12)), NOW, 4)).toBe(true);
  });

  it('leaves a suspended, retired, new or learning card alone', () => {
    const far = new Date(2027, 8, 1, 12);
    expect(drillDueTooFar(due(far, { suspended: true }), NOW, 4)).toBe(false);
    expect(drillDueTooFar(due(far, { retired: true }), NOW, 4)).toBe(false);
    expect(drillDueTooFar({ ...card, sched: { ...card.sched, state: 1, due: far.toISOString() } }, NOW, 4)).toBe(false);
    expect(drillDueTooFar(card, NOW, 4)).toBe(false);
  });
});

describe('a step set aside', () => {
  it('reads why from its tags, the learner\'s stop first', () => {
    expect(setAsideOf(['skill', 'skill::stopped'])).toBe('stopped');
    expect(setAsideOf(['skill', 'skill::covered'])).toBe('covered');
    expect(setAsideOf(['skill', 'skill::covered', 'skill::stopped'])).toBe('stopped');
    expect(setAsideOf(['skill'])).toBeUndefined();
  });
});
