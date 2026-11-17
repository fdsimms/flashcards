import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/wanikani/log';
import { answerSummary, comingUp, FORECAST_HOURS, hourlyForecast, levelLine, levelProgress, parseStats, stagesLabel, startedTotal } from '../../src/wanikani/stats';

const now = new Date(2026, 10, 12, 12);
const stages = { apprentice: 41, guru: 187, master: 76, enlightened: 22, burned: 9 };

describe('level progress', () => {
  it('needs 90% of the level\'s kanji at Guru, rounded up', () => {
    expect(levelProgress(12, 33, 24)).toEqual({ level: 12, kanjiTotal: 33, kanjiPassed: 24, needed: 30, remaining: 6 });
    expect(levelProgress(12, 33, 31)?.remaining).toBe(0);
  });

  it('says nothing on the last level or with no kanji read', () => {
    expect(levelProgress(60, 30, 1)).toBeNull();
    expect(levelProgress(12, 0, 0)).toBeNull();
  });

  it('puts the kanji still needed in the row\'s line, only for the level it was read for', () => {
    expect(levelLine(12, levelProgress(12, 33, 24))).toBe('Level 12 · 6 kanji to level 13');
    expect(levelLine(12, levelProgress(12, 33, 31))).toBe('Level 12');
    expect(levelLine(13, levelProgress(12, 33, 24))).toBe('Level 13');
    expect(levelLine(12, null)).toBe('Level 12');
  });
});

describe('the forecast', () => {
  const at = (hours: number, minutes = 0) => new Date(now.getTime() + hours * 3_600_000 + minutes * 60_000).toISOString();

  it('counts what is waiting as now and the rest by hour from now', () => {
    const f = hourlyForecast([
      { availableAt: at(-5), count: 23 }, { availableAt: at(0, 30), count: 2 }, { availableAt: at(1), count: 4 }, { availableAt: at(1, 20), count: 1 }, { availableAt: at(23, 59), count: 7 },
    ], now);
    expect(f).toHaveLength(FORECAST_HOURS);
    expect(f[0]).toBe(25);
    expect(f[1]).toBe(5);
    expect(f[23]).toBe(7);
  });

  it('leaves out what is past the window or has no usable time', () => {
    expect(hourlyForecast([{ availableAt: at(24), count: 9 }, { availableAt: 'soon', count: 3 }], now).every((n) => n === 0)).toBe(true);
  });

  it('adds up what comes after now', () => {
    expect(comingUp([20, 3, 0, 4])).toBe(7);
  });
});

describe('stage counts', () => {
  it('adds the groups and names them for VoiceOver', () => {
    expect(startedTotal(stages)).toBe(335);
    expect(stagesLabel(stages)).toBe('41 Apprentice, 187 Guru, 76 Master, 22 Enlightened, 9 Burned');
  });
});

describe('stored stats', () => {
  const stats = { savedAt: now.toISOString(), level: 12, stages, progress: levelProgress(12, 33, 24), forecast: new Array(FORECAST_HOURS).fill(1) };

  it('reads back what was saved', () => {
    expect(parseStats(JSON.stringify(stats))).toEqual(stats);
  });

  it('refuses a file that is not stats', () => {
    expect(parseStats(null)).toBeNull();
    expect(parseStats('{')).toBeNull();
    expect(parseStats(JSON.stringify({ ...stats, forecast: [1] }))).toBeNull();
    expect(parseStats(JSON.stringify({ ...stats, stages: { guru: 1 } }))).toBeNull();
  });
});

describe('answers given in Franki', () => {
  const entry = (when: Date, kind: LogEntry['kind'], wrong = 0): LogEntry => ({ at: when.toISOString(), assignmentId: 1, kind, wrong, takenMs: 1000 });
  const daysAgo = (n: number, hour = 12) => new Date(2026, 10, 12 - n, hour);

  it('counts today and the last 7 study days, with the share right first time', () => {
    const log = [
      entry(daysAgo(0), 'review'), entry(daysAgo(0), 'review', 2), entry(daysAgo(0), 'start'),
      entry(daysAgo(6), 'review'), entry(daysAgo(7), 'review', 1),
    ];
    expect(answerSummary(log, now, 4)).toEqual({ reviewsToday: 2, lessonsToday: 1, reviewsWeek: 3, rightFirstTimeWeek: 67 });
  });

  it('counts an answer before the day starts as the day before', () => {
    const log = [entry(new Date(2026, 10, 12, 2), 'review')];
    expect(answerSummary(log, now, 4).reviewsToday).toBe(0);
    expect(answerSummary(log, now, 0).reviewsToday).toBe(1);
  });

  it('has no percentage with no reviews', () => {
    expect(answerSummary([], now, 4).rightFirstTimeWeek).toBeNull();
  });
});
