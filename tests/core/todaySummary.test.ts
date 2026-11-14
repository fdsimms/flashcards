import { describe, expect, it } from 'vitest';
import type { Answer } from '../../src/core/stats';
import { todaySummary } from '../../src/core/todaySummary';

const H = 4;
const NOW = new Date(2026, 10, 11, 12);
const answer = (cardId: string, at: Date, over: Partial<Answer> = {}): Answer => ({ cardId, at, rating: 3, kind: 'review', wasNew: false, takenMs: 6000, ...over });

describe('today\'s summary', () => {
  it('says nothing before the first answer of the study day', () => {
    expect(todaySummary([], NOW, H).text).toBeNull();
    // Yesterday's answer doesn't count today.
    expect(todaySummary([answer('a', new Date(2026, 10, 10, 20))], NOW, H).text).toBeNull();
  });

  it('counts answers, time and cards answered for the first time', () => {
    const answers = [
      answer('a', new Date(2026, 10, 11, 9), { kind: 'learn', wasNew: true, takenMs: 60000 }),
      answer('b', new Date(2026, 10, 11, 10), { takenMs: 120000 }),
      answer('b', new Date(2026, 10, 11, 11), { takenMs: 60000 }),
    ];
    const s = todaySummary(answers, NOW, H);
    expect(s).toMatchObject({ answered: 3, newCards: 1, takenMs: 240000 });
    expect(s.text).toBe('Studied today: 3 answers · 4 min · 1 new');
  });

  it('uses the singular for one answer', () => {
    expect(todaySummary([answer('a', new Date(2026, 10, 11, 9))], NOW, H).text).toMatch(/^Studied today: 1 answer · /);
  });

  it('belongs a 1 AM answer to the day before', () => {
    const early = new Date(2026, 10, 11, 1);
    expect(todaySummary([answer('a', early)], new Date(2026, 10, 11, 3), H).answered).toBe(1);
    expect(todaySummary([answer('a', early)], new Date(2026, 10, 11, 5), H).answered).toBe(0);
  });

  it('does not count a learning card first answered yesterday as new again', () => {
    const answers = [
      answer('a', new Date(2026, 10, 10, 20), { kind: 'learn', wasNew: true }),
      answer('a', new Date(2026, 10, 11, 9), { kind: 'learn', wasNew: true }),
    ];
    expect(todaySummary(answers, NOW, H).newCards).toBe(0);
  });
});
