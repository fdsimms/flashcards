import { describe, expect, it } from 'vitest';
import { computeStats } from '../../src/core/stats';
import { answersFromLog, LOG_DAYS, logOutcomes, parseLog } from '../../src/wanikani/log';
import type { Outcome } from '../../src/wanikani/session';

const now = new Date(2026, 10, 12, 12);
const at = (d: Date) => d.toISOString();
const review = (id: number, wrong: number, when: Date): Outcome => ({
  kind: 'review', assignmentId: id, subjectId: id, srsStage: 3, wrongMeaning: wrong, wrongReading: 0, at: at(when), takenMs: 4000,
});

describe('the answer log', () => {
  it('keeps each finished item with its misses and time, and drops what is over a year old', () => {
    const old = { at: at(new Date(now.getTime() - (LOG_DAYS + 1) * 86_400_000)), assignmentId: 9, kind: 'review' as const, wrong: 0, takenMs: 0 };
    const log = logOutcomes([old], [review(1, 2, now), { kind: 'start', assignmentId: 2, subjectId: 2, at: at(now) }], now);
    expect(log).toEqual([
      { at: at(now), assignmentId: 1, kind: 'review', wrong: 2, takenMs: 4000 },
      { at: at(now), assignmentId: 2, kind: 'start', wrong: 0, takenMs: 0 },
    ]);
    expect(parseLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
    expect(parseLog('nope')).toEqual([]);
  });

  it("counts in Stats as answers: misses as Again, lessons as new cards", () => {
    const log = logOutcomes([], [review(1, 0, now), review(2, 1, now), { kind: 'start', assignmentId: 3, subjectId: 3, at: at(now), takenMs: 1000 }], now);
    const stats = computeStats({ cards: [], answers: answersFromLog(log), now, dayStartsAtHour: 4, days: 30 });
    expect(stats.today).toEqual({ answered: 3, takenMs: 9000, again: 1, newCards: 1 });
    expect(stats.retention.week).toEqual({ passed: 1, total: 2 });
  });
});
