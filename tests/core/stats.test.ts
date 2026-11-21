import { describe, expect, it } from 'vitest';
import {
  answerButtons, answerCalendar, answersByHour, answersFrom, answerStreaks, CALENDAR_DAYS, calendarStart, computeStats,
  INTERVAL_GROUPS, intervalGroups, intervalText, MATURE_DAYS, percent, STATS_RANGES, subdeckLevels, trueRetention, type Answer, type Calendar,
} from '../../src/core/stats';
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

describe('answers for stats, when the review log lacks one', () => {
  it("counts Franki's own row for an Anki card's answer whose Anki write failed", () => {
    const cards = [card('a', { ankiId: '100' })];
    const revlog = [{ id: new Date(2026, 10, 11, 9).getTime() + 1, cid: 100, ease: 3, lastIvl: 0, time: 4000, type: 0 }];
    const reviews: ReviewLogEntry[] = [
      // In the log (a millisecond later, as when two answers share one): counted once, from it.
      { cardId: 'a', rating: 3, reviewedAt: new Date(2026, 10, 11, 9).toISOString(), state: 0, due: '', stability: 1, difficulty: 1 },
      // Not in it.
      { cardId: 'a', rating: 1, reviewedAt: new Date(2026, 10, 11, 9, 5).toISOString(), state: 1, due: '', stability: 1, difficulty: 1 },
    ];
    expect(answersFrom({ revlog, reviews, cards }).map((a) => [a.at.getMinutes(), a.rating, a.takenMs])).toEqual([[0, 3, 4000], [5, 1, 0]]);
  });
});

describe('stats', () => {
  it('starts every past day at the day-start hour, even across a spring-forward gap', () => {
    // In a zone where 2 AM doesn't exist on the change day, the days before it still start at 2 AM.
    const s = computeStats({ cards: [], answers: [], now: new Date(2026, 2, 12, 12), dayStartsAtHour: 2, days: 30 });
    const early = s.past.slice(0, 5);
    expect(early.map((d) => d.start.getHours())).toEqual([2, 2, 2, 2, 2]);
  });

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
});

describe('time spent', async () => {
  const { durationText } = await import('../../src/core/stats');
  it('reads as people say it', () => {
    const sp = (s: string) => s.replace(/\u00a0/g, ' ');
    expect(sp(durationText(0))).toBe('0 min');
    expect(durationText(20_000)).toBe('<\u00a01\u00a0min');
    expect(sp(durationText(12 * 60_000))).toBe('12 min');
    expect(durationText(250 * 60_000)).toBe('4\u00a0h\u00a010\u00a0min');
    expect(sp(durationText(120 * 60_000))).toBe('2 h');
  });
});

describe('calendar', () => {
  const flat = (weeks: Calendar['weeks']) => weeks.flat().filter((d) => d !== null);

  it('lays out a year of study days in weeks from Sunday, ending today', () => {
    const cal = answerCalendar({ answers: [], now: NOW, dayStartsAtHour: H });
    const days = flat(cal.weeks);
    expect(days).toHaveLength(CALENDAR_DAYS);
    expect(days[0].key).toBe('2025-11-12');
    expect(days[0].start).toEqual(calendarStart(NOW, H));
    expect(days.at(-1)!.key).toBe('2026-11-11');
    expect(cal.weeks.every((w) => w.length === 7)).toBe(true);
    // 2025-11-12 was a Wednesday, and 2026-11-11 is one too.
    expect(cal.weeks[0].slice(0, 4).map((d) => d?.key ?? null)).toEqual([null, null, null, '2025-11-12']);
    expect(cal.weeks.at(-1)!.map((d) => d?.key ?? null)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', null, null, null]);
    expect(cal).toMatchObject({ days: CALENDAR_DAYS, studied: 0, total: 0, busiest: null });
  });

  it('counts every answer on its study day, not its calendar day', () => {
    const answers = [
      answer('a', new Date(2026, 10, 11, 2), { kind: 'learn' }), // 2 AM: the 10th's study day
      answer('a', new Date(2026, 10, 11, 9), { kind: 'relearn' }),
      answer('b', new Date(2026, 10, 11, 10)),
      answer('c', new Date(2025, 10, 12, 3)), // 3 AM: the day before the first one shown
      answer('c', new Date(2025, 10, 12, 5)),
    ];
    const cal = answerCalendar({ answers, now: NOW, dayStartsAtHour: H });
    const byKey = new Map(flat(cal.weeks).map((d) => [d.key, d.answers]));
    expect(byKey.get('2026-11-11')).toBe(2);
    expect(byKey.get('2026-11-10')).toBe(1);
    expect(byKey.get('2025-11-12')).toBe(1);
    expect(cal).toMatchObject({ studied: 3, total: 4 });
    expect(cal.busiest?.key).toBe('2026-11-11');
  });

  it('shades a day by its rank among the days studied', () => {
    const answers: Answer[] = [];
    // Eight days, with 1 to 8 answers.
    for (let n = 1; n <= 8; n++) for (let i = 0; i < n; i++) answers.push(answer(`c${n}`, new Date(2026, 10, n, 12)));
    const cal = answerCalendar({ answers, now: NOW, dayStartsAtHour: H });
    expect(flat(cal.weeks).filter((d) => d.key >= '2026-11-01').map((d) => d.level)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 0, 0, 0]);
  });

  it('draws days that tie at the same shade', () => {
    const answers = [1, 2, 3].map((d) => answer('a', new Date(2026, 10, d, 12)));
    const cal = answerCalendar({ answers, now: NOW, dayStartsAtHour: H });
    expect(flat(cal.weeks).filter((d) => d.answers).map((d) => d.level)).toEqual([4, 4, 4]);
  });
});

describe('intervals', () => {
  it('groups review cards by interval, leaving out the rest', () => {
    const cards = [
      ...[1, 2, 3, 4, 6, 7, 13, 20, MATURE_DAYS, 30, 31, 365, 366, 731, 2000].map((d, i) => card(`r${i}`, { state: 2, scheduledDays: d })),
      card('new'),
      card('learning', { state: 1, scheduledDays: 0 }),
      card('relearning', { state: 3, scheduledDays: 0 }),
      card('suspended', { state: 2, scheduledDays: 5, suspended: true }),
      card('retired', { state: 2, scheduledDays: 5, retired: true }),
    ];
    const out = intervalGroups(cards);
    expect(out.groups.map((g) => g.label)).toEqual(INTERVAL_GROUPS.map((g) => g.label));
    expect(Object.fromEntries(out.groups.map((g) => [g.label, g.cards]))).toEqual({
      '1 day': 1, '2 days': 1, '3 days': 1, '4 to 6 days': 2, '1 to 2 weeks': 2, '2 to 3 weeks': 1,
      '3 weeks to a month': 2, '1 to 2 months': 1, '2 to 3 months': 0, '3 to 6 months': 0,
      '6 months to a year': 1, '1 to 2 years': 1, 'Over 2 years': 2,
    });
    expect(out.total).toBe(15);
    expect(out.longest).toBe(2000);
  });

  it('agrees with the young and mature counts', () => {
    const cards = [3, 20, MATURE_DAYS, 100].map((d, i) => card(`r${i}`, { state: 2, scheduledDays: d }));
    const { counts } = computeStats({ cards, answers: [], now: NOW, dayStartsAtHour: H, days: 7 });
    const out = intervalGroups(cards);
    const matureFrom = INTERVAL_GROUPS.findIndex((g) => g.max >= MATURE_DAYS);
    expect(out.groups.slice(0, matureFrom).reduce((n, g) => n + g.cards, 0)).toBe(counts.young);
    expect(out.groups.slice(matureFrom).reduce((n, g) => n + g.cards, 0)).toBe(counts.mature);
    expect(out.average).toBe((3 + 20 + MATURE_DAYS + 100) / 4);
  });

  it('has nothing to average with no review cards', () => {
    expect(intervalGroups([card('new')])).toMatchObject({ total: 0, average: 0, longest: 0 });
  });

  it('says an interval as people do', () => {
    expect(intervalText(1)).toBe('1 day');
    expect(intervalText(12.4)).toBe('12 days');
    expect(intervalText(30)).toBe('30 days');
    expect(intervalText(31)).toBe('1 month');
    expect(intervalText(95)).toBe('3 months');
    expect(intervalText(365)).toBe('1 year');
    expect(intervalText(548)).toBe('1.5 years');
  });
});

describe('answer buttons', () => {
  it('counts each button by learning, young and mature, within the range', () => {
    const answers = [
      answer('a', new Date(2026, 10, 11, 9), { kind: 'learn', rating: 1 }),
      answer('a', new Date(2026, 10, 11, 9, 5), { kind: 'relearn', rating: 3 }),
      answer('b', new Date(2026, 10, 10, 9), { rating: 2, lastIntervalDays: 3 }),
      answer('c', new Date(2026, 10, 10, 9), { rating: 4 }), // no interval known (Franki's table): young
      answer('d', new Date(2026, 10, 10, 9), { rating: 1, lastIntervalDays: MATURE_DAYS }),
      answer('e', new Date(2026, 10, 10, 9), { rating: 3, lastIntervalDays: 40, preview: true }), // a preview: not counted
      answer('f', new Date(2026, 9, 1, 9), { rating: 3, lastIntervalDays: 40 }), // before the range
    ];
    const out = answerButtons({ answers, since: calendarStart(NOW, H, 30) });
    expect(out.learning).toEqual({ pressed: [1, 0, 1, 0], total: 2, passed: 1 });
    expect(out.young).toEqual({ pressed: [0, 1, 0, 1], total: 2, passed: 2 });
    expect(out.mature).toEqual({ pressed: [1, 0, 0, 0], total: 1, passed: 0 });
  });

  it('offers ranges no longer than the answers the screen loads', () => {
    expect(Math.max(...STATS_RANGES.map((r) => r.days))).toBeLessThanOrEqual(CALENDAR_DAYS);
  });
});

describe('answers by hour', () => {
  it('runs the hours from the start of the study day, late nights last', () => {
    const answers = [
      answer('a', new Date(2026, 10, 11, 4, 30)),
      answer('a', new Date(2026, 10, 11, 9, 10), { rating: 1 }),
      answer('b', new Date(2026, 10, 11, 9, 50), { kind: 'learn' }),
      answer('c', new Date(2026, 10, 11, 2, 15)), // 2 AM: near the end of the study day before
      answer('d', new Date(2026, 9, 1, 9)), // before the range
    ];
    const out = answersByHour({ answers, since: calendarStart(NOW, H, 30), dayStartsAtHour: H });
    expect(out).toHaveLength(24);
    expect(out[0]).toEqual({ hour: 4, total: 1, passed: 1 });
    expect(out[5]).toEqual({ hour: 9, total: 2, passed: 1 });
    expect(out[22]).toEqual({ hour: 2, total: 1, passed: 1 });
    expect(out.at(-1)!.hour).toBe(3);
    expect(out.reduce((n, h) => n + h.total, 0)).toBe(4);
  });
});

describe('true retention', () => {
  it('splits reviews by period and by young and mature, on study days', () => {
    const answers = [
      answer('a', new Date(2026, 10, 11, 9), { lastIntervalDays: 40 }), // today
      answer('b', new Date(2026, 10, 11, 2), { rating: 1, lastIntervalDays: 3 }), // 2 AM: yesterday's study day
      answer('c', new Date(2026, 10, 10, 9), { lastIntervalDays: 3 }), // yesterday
      answer('d', new Date(2026, 10, 1, 9), { rating: 1, lastIntervalDays: 40 }), // ten days ago: the month
      answer('e', new Date(2026, 1, 1, 9), { lastIntervalDays: 3 }), // in the year
      answer('f', new Date(2026, 10, 11, 9), { kind: 'learn', rating: 1 }), // a step: not counted
      answer('g', new Date(2026, 10, 11, 9), { rating: 1, preview: true }), // a preview: not counted
    ];
    const rows = trueRetention({ answers, now: NOW, dayStartsAtHour: H });
    const r = (p: { passed: number; total: number }) => `${p.passed}/${p.total}`;
    expect(rows.map((x) => [x.label, r(x.young), r(x.mature), r(x.all)])).toEqual([
      ['Today', '0/0', '1/1', '1/1'],
      ['Yesterday', '1/2', '0/0', '1/2'],
      ['Last 7 days', '1/2', '1/1', '2/3'],
      ['Last 30 days', '1/2', '1/2', '2/4'],
      ['Last year', '2/3', '1/2', '3/5'],
    ]);
    expect(percent(rows[4].all)).toBe(60);
    expect(percent({ passed: 0, total: 0 })).toBeNull();
  });
});

describe('streaks', () => {
  const streaks = (dates: Date[]) => answerStreaks(answerCalendar({ answers: dates.map((d) => answer('a', d)), now: NOW, dayStartsAtHour: H }));

  it('counts days in a row up to today, and the longest run', () => {
    expect(streaks([
      new Date(2026, 9, 1, 9), new Date(2026, 9, 2, 9), new Date(2026, 9, 3, 9), new Date(2026, 9, 4, 9),
      new Date(2026, 10, 10, 9), new Date(2026, 10, 11, 3), // 3 AM: the 10th's study day too
      new Date(2026, 10, 11, 9),
    ])).toEqual({ current: 2, longest: 4 });
  });

  it("keeps the streak while today isn't studied yet, and ends it after a missed day", () => {
    expect(streaks([new Date(2026, 10, 9, 9), new Date(2026, 10, 10, 9)])).toEqual({ current: 2, longest: 2 });
    expect(streaks([new Date(2026, 10, 9, 9)])).toEqual({ current: 0, longest: 1 });
    expect(streaks([])).toEqual({ current: 0, longest: 0 });
  });
});

describe('subdeck levels', () => {
  const decks = ['Polski', 'Polski::Odmiana::Rzeczowniki', 'Polski::Słówka', 'Polski::Odmiana', 'Thai'];

  it('offers each level of subdecks down to the deck chosen', () => {
    expect(subdeckLevels(decks, null)).toEqual([]);
    expect(subdeckLevels(decks, 'Polski')).toEqual([{ parent: 'Polski', children: ['Polski::Odmiana', 'Polski::Słówka'] }]);
    expect(subdeckLevels(decks, 'Polski::Odmiana')).toEqual([
      { parent: 'Polski', children: ['Polski::Odmiana', 'Polski::Słówka'] },
      { parent: 'Polski::Odmiana', children: ['Polski::Odmiana::Rzeczowniki'] },
    ]);
    expect(subdeckLevels(decks, 'Thai')).toEqual([]);
  });

  it('finds a subdeck that only a deeper deck names', () => {
    expect(subdeckLevels(['A::B::C'], 'A')).toEqual([{ parent: 'A', children: ['A::B'] }]);
  });
});
