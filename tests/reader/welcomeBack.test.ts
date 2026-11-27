import { describe, expect, it } from 'vitest';
import type { SoFar } from '../../src/reader/api';
import { awayText, recapsShown, RECENT_EPISODES, WELCOME_BACK_DAYS, welcomeBackDue } from '../../src/reader/welcomeBack';

const recaps = (n: number) => Array.from({ length: n }, (_, i) => ({ episode: i + 1, recap: `Episode ${i + 1} happens.` }));
const soFar = (n: number, away: number | null): SoFar => ({ recaps: recaps(n), away_days: away, characters: [] });

describe('welcomeBackDue', () => {
  it('is due once the learner has been away the threshold', () => {
    expect(welcomeBackDue(soFar(4, WELCOME_BACK_DAYS))).toBe(true);
    expect(welcomeBackDue(soFar(4, WELCOME_BACK_DAYS - 1))).toBe(false);
  });
  it('is not due with nothing to recap, no earlier reading, or an older server', () => {
    expect(welcomeBackDue(soFar(0, 30))).toBe(false);
    expect(welcomeBackDue(soFar(4, null))).toBe(false);
    expect(welcomeBackDue(undefined)).toBe(false);
    expect(welcomeBackDue(null)).toBe(false);
  });
});

describe('awayText', () => {
  it('says days, then weeks, then months', () => {
    expect(awayText(1)).toBe('1 day');
    expect(awayText(9)).toBe('9 days');
    expect(awayText(21)).toBe('3 weeks');
    expect(awayText(90)).toBe('3 months');
  });
});

describe('recapsShown', () => {
  it('lists the latest few, or all of them', () => {
    const s = soFar(10, 0);
    expect(recapsShown(s, false).map((r) => r.episode)).toEqual([8, 9, 10].slice(-RECENT_EPISODES));
    expect(recapsShown(s, true)).toHaveLength(10);
    expect(recapsShown(soFar(2, 0), false)).toHaveLength(2);
  });
});
