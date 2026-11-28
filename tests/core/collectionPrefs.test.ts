import { describe, expect, it } from 'vitest';
import { parseMinutes, prefsOf, prefsProblem, withPrefs } from '../../src/core/collectionPrefs';
import type { CollectionSettings } from '../../src/core/types';

const CS: CollectionSettings = { dayStartsAtHour: 4, learnAheadMinutes: 20, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false, collectionCreated: 1700000000 };

describe('collection preferences', () => {
  it('reads the settings in minutes, with the load balancer on unless turned off', () => {
    expect(prefsOf(CS)).toEqual({ dayStartsAtHour: 4, learnAheadMinutes: 20, timeLimitMinutes: 0, newCardsIgnoreReviewLimit: false, applyAllParentLimits: false, loadBalancer: true });
    expect(prefsOf({ ...CS, timeLimitSecs: 1800, loadBalancer: false })).toMatchObject({ timeLimitMinutes: 30, loadBalancer: false });
  });
  it('applies a change and keeps the rest, a time limit of 0 turning it off', () => {
    expect(withPrefs(CS, { dayStartsAtHour: 5, timeLimitMinutes: 15 })).toEqual({ ...CS, dayStartsAtHour: 5, timeLimitSecs: 900 });
    expect(withPrefs({ ...CS, timeLimitSecs: 900 }, { timeLimitMinutes: 0 })).toEqual(CS);
  });
  it('takes whole minutes and refuses the rest with the reason', () => {
    expect(parseMinutes(' 30 ')).toEqual({ minutes: 30 });
    expect(parseMinutes('0')).toEqual({ minutes: 0 });
    expect(parseMinutes('1.5')).toEqual({ error: 'Enter a whole number of minutes.' });
    expect(parseMinutes('')).toEqual({ error: 'Enter a whole number of minutes.' });
    expect(parseMinutes('10000')).toEqual({ error: 'Enter 9999 minutes or fewer.' });
  });
  it('refuses an hour outside the day', () => {
    expect(prefsProblem({ dayStartsAtHour: 24 })).toBeDefined();
    expect(prefsProblem({ dayStartsAtHour: 0, learnAheadMinutes: 0 })).toBeUndefined();
    expect(prefsProblem({ timeLimitMinutes: -1 })).toBeDefined();
  });
});
