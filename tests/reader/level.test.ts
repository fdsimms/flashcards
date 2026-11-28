import { describe, expect, it } from 'vitest';
import type { Level } from '../../src/reader/api';
import { bandLabel, bandShare, changeLine, chartPoints, levelChange, levelHeadline, levelSummary, speechPercent } from '../../src/reader/level';

const day = (d: string, known_top: number) => ({ day: d, known_top, speech: null });

const LEVEL: Level = {
  top: 2000,
  known_top: 1240,
  speech: 0.8137,
  studied: 1650,
  bands: [{ start: 1, end: 500, known: 455 }, { start: 501, end: 1000, known: 360 }],
  history: [day('2026-10-31', 1144), day('2026-11-14', 1200), day('2026-11-28', 1240)],
};

describe('Your level', () => {
  it('says the headline, the share of speech and the bands', () => {
    expect(levelHeadline(LEVEL)).toBe('1,240 of the 2,000 most common words');
    expect(speechPercent(LEVEL)).toBe(81);
    expect(speechPercent({ speech: null })).toBeNull();
    expect(bandLabel({ start: 1, end: 500 })).toBe('Top 500');
    expect(bandLabel({ start: 1001, end: 2000 })).toBe('1,001–2,000');
    expect(bandShare({ start: 501, end: 1000, known: 360 })).toBe(0.72);
  });

  it('measures the change over four weeks, from the figure on or before then', () => {
    expect(levelChange(LEVEL.history)).toEqual({ words: 96, days: 28 });
    expect(levelSummary(LEVEL)).toBe('About 81% of everyday speech. Up 96 words in 4 weeks.');
    // An older figure than four weeks is used when there's none on the day itself.
    expect(levelChange([day('2026-10-20', 1000), day('2026-11-02', 1100), day('2026-11-28', 1240)])).toEqual({ words: 240, days: 39 });
    expect(changeLine({ words: 240, days: 39 })).toBe('Up 240 words in 6 weeks.');
  });

  it('says nothing about a trend under a week old, and uses its real length until four weeks', () => {
    expect(levelChange([day('2026-11-25', 1230), day('2026-11-28', 1240)])).toBeNull();
    expect(levelChange([])).toBeNull();
    expect(changeLine(levelChange([day('2026-11-14', 1250), day('2026-11-28', 1240)]))).toBe('Down 10 words in 2 weeks.');
    expect(changeLine(levelChange([day('2026-11-18', 1240), day('2026-11-28', 1240)]))).toBe('No change in 10 days.');
    expect(changeLine({ words: 1, days: 9 })).toBe('Up 1 word in 9 days.');
  });

  it('charts the last twelve weeks, counted back from the newest figure', () => {
    expect(chartPoints([day('2026-08-01', 700), ...LEVEL.history])).toEqual([
      { daysAgo: 28, known: 1144 }, { daysAgo: 14, known: 1200 }, { daysAgo: 0, known: 1240 },
    ]);
  });

  it('counts across a change of clocks as whole days', () => {
    expect(levelChange([day('2026-03-01', 10), day('2026-03-29', 20)])).toEqual({ words: 10, days: 28 });
  });
});
