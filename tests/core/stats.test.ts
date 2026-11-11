import { describe, expect, it } from 'vitest';
import { answersFrom, computeStats, MATURE_DAYS, percent, type Answer } from '../../src/core/stats';
import type { Card, ReviewLogEntry } from '../../src/core/types';
import { NOW } from '../support/fixtures';

const H = 4;

function card(id: string, over: Partial<Card['sched']> & { suspended?: boolean; retired?: boolean; ankiId?: string } = {}): Card {
  const { suspended = false, retired = false, ankiId, ...sched } = over;
  return {
    id, noteId: `n-${id}`, kind: 't0', suspended, retired, ankiId,
    sched: { due: NOW.toISOString(), stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 0, lapses: 0, state: 0, lastReview: null, ...sched },
  };
}

const answer = (cardId: string, at: Date, over: Partial<Answer> = {}): Answer => ({ cardId, at, rating: 3, kind: 'review', wasNew: false, takenMs: 6000, ...over });

describe('answers for stats', () => {
  it('takes an Anki card\'s answers from the review log, and only Franki\'s table for a card Anki doesn\'t have', () => {
    const cards = [card('a', { ankiId: '100' }), card('b')];
    const revlog = [
      { id: new Date(2026, 10, 11, 9).getTime(), cid: 100, ease: 3, lastIvl: 0, time: 4000, type: 0 },
      { id: new Date(2026, 10, 11, 10).getTime(), cid: 100, ease: 1, lastIvl: 30, time: 9000, type: 1 },
      { id: new Date(2026, 10, 11, 11).getTime(), cid: 100, ease: 0, lastIvl: 30, time: 0, type: 4 }, // a reschedule
      { id: new Date(2026, 10, 11, 11).getTime(), cid: 999, ease: 3, lastIvl: 0, time: 0, type: 0 }, // not a card here
    ];
    const reviews: ReviewLogEntry[] = [
      { cardId: 'a', rating: 3, reviewedAt: new Date(2026, 10, 11, 10).toISOString(), state: 2, due: '', stability: 1, difficulty: 1 },
      { cardId: 'b', rating: 2, reviewedAt: new Date(2026, 10, 11, 10).toISOString(), state: 3, due: '', stability: 1, difficulty: 1 },
    ];
    const out = answersFrom({ revlog, reviews, cards });
    expect(out.map((a) => [a.cardId, a.kind, a.rating, a.wasNew, a.lastIntervalDays, a.takenMs])).toEqual([
      ['a', 'learn', 3, true, undefined, 4000],
      ['a', 'review', 1, false, 30, 9000],
      ['b', 'relearn', 2, false, undefined, 0],
    ]);
  });
});

describe('stats', () => {
  it('counts today from the start of the study day, not midnight', () => {
    const answers = [
      answer('x', new Date(2026, 10, 11, 2), { kind: 'learn', wasNew: true }), // 2 AM: still yesterday
      answer('y', new Date(2026, 10, 11, 5), { kind: 'learn', wasNew: true }),
      answer('y', new Date(2026, 10, 11, 6), { kind: 'learn', wasNew: true }),
      answer('z', new Date(2026, 10, 11, 7), { rating: 1 }),
    ];
    const s = computeStats({ cards: [], answers, now: NOW, dayStartsAtHour: H, days: 30 });
    expect(s.today).toEqual({ answered: 3, takenMs: 18000, again: 1, newCards: 1 });
    expect(s.past).toHaveLength(30);
    expect(s.past.at(-1)).toMatchObject({ key: '2026-11-11', learn: 2, review: 1 });
    expect(s.past.at(-2)).toMatchObject({ key: '2026-11-10', learn: 1 });
  });

  it('doesn\'t count a card as new today when it was answered on an earlier day', () => {
    const answers = [
      answer('y', new Date(2026, 10, 10, 9), { kind: 'learn', wasNew: true }),
      answer('y', new Date(2026, 10, 11, 9), { kind: 'learn', wasNew: true }),
    ];
    expect(computeStats({ cards: [], answers, now: NOW, dayStartsAtHour: H, days: 30 }).today.newCards).toBe(0);
  });

  it('puts each card in one stage, and forecasts what comes due', () => {
    const cards = [
      card('new'),
      card('learning', { state: 1, due: new Date(2026, 10, 11, 18).toISOString() }),
      card('young', { state: 2, scheduledDays: 3, due: new Date(2026, 10, 13, 10).toISOString() }),
      card('mature', { state: 2, scheduledDays: MATURE_DAYS, due: new Date(2026, 10, 12, 2).toISOString() }), // 2 AM: still the 11th's study day
      card('late', { state: 2, scheduledDays: 5, due: new Date(2026, 10, 9, 10).toISOString() }),
      card('far', { state: 2, scheduledDays: 90, due: new Date(2027, 2, 1).toISOString() }),
      card('suspended', { state: 2, suspended: true }),
      card('retired', { state: 2, retired: true }),
    ];
    const s = computeStats({ cards, answers: [], now: NOW, dayStartsAtHour: H, days: 7 });
    expect(s.counts).toEqual({ new: 1, learning: 1, young: 2, mature: 2, suspended: 1 });
    expect(s.overdue).toBe(1);
    expect(s.forecast.map((d) => [d.key, d.due])).toEqual([
      ['2026-11-11', 2], ['2026-11-12', 0], ['2026-11-13', 1], ['2026-11-14', 0], ['2026-11-15', 0], ['2026-11-16', 0], ['2026-11-17', 0],
    ]);
  });

  it('measures retention on reviews only, with mature cards apart', () => {
    const answers = [
      answer('a', new Date(2026, 10, 10, 9), { lastIntervalDays: 40 }),
      answer('b', new Date(2026, 10, 10, 9), { rating: 1, lastIntervalDays: 40 }),
      answer('c', new Date(2026, 10, 1, 9), { lastIntervalDays: 3 }), // ten days ago: the month, not the week
      answer('d', new Date(2026, 10, 10, 9), { kind: 'learn', rating: 1 }),
    ];
    const s = computeStats({ cards: [], answers, now: NOW, dayStartsAtHour: H, days: 30 });
    expect(s.retention).toEqual({ week: { passed: 1, total: 2 }, month: { passed: 2, total: 3 }, matureMonth: { passed: 1, total: 2 } });
    expect(percent(s.retention.month)).toBe(67);
    expect(percent({ passed: 0, total: 0 })).toBeNull();
  });
});

describe('time spent', async () => {
  const { durationText } = await import('../../src/core/stats');
  it('reads as people say it', () => {
    const sp = (s: string) => s.replace(/\u00a0/g, ' ');
    expect(sp(durationText(0))).toBe('0 min');
    expect(durationText(20_000)).toBe('under a minute');
    expect(sp(durationText(12 * 60_000))).toBe('12 min');
    expect(durationText(250 * 60_000)).toBe('4\u00a0h\u00a010\u00a0min');
    expect(sp(durationText(120 * 60_000))).toBe('2 h');
  });
});
