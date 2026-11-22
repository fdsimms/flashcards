import { describe, expect, it } from 'vitest';
import { type DrillSeen, drawUnseen, forgetSeen, mergeSeen, missedList, parseSeen, recordSeen, SEEN_KEPT, seenList } from '../../src/tools/drillSeen';
import { drawQuestion, drawRound, drillStep, questionKey } from '../../src/tools/skills';

const LIST = seenList('th', 'time-hours');

/** A repeatable stand-in for Math.random. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('remembering what a step asked', () => {
  it('puts the newest last, and moves a repeat to the end rather than listing it twice', () => {
    let seen = recordSeen({}, LIST, 'a');
    seen = recordSeen(seen, LIST, 'b');
    seen = recordSeen(seen, LIST, 'a');
    expect(seen[LIST]).toEqual(['b', 'a']);
  });

  it('keeps only the most recent SEEN_KEPT', () => {
    let seen: DrillSeen = {};
    for (let i = 0; i < SEEN_KEPT + 5; i++) seen = recordSeen(seen, LIST, String(i));
    expect(seen[LIST]).toHaveLength(SEEN_KEPT);
    expect(seen[LIST][0]).toBe('5');
  });

  it('reads back leniently', () => {
    expect(parseSeen(null)).toEqual({});
    expect(parseSeen([1])).toEqual({});
    expect(parseSeen({ x: ['a', 3, 'b'], y: 'no', z: [] })).toEqual({ x: ['a', 'b'] });
  });

  it('keeps questions asked before the file was read, after what it held', () => {
    expect(mergeSeen({ a: ['1', '2'] }, { a: ['2', '3'], b: ['9'] })).toEqual({ a: ['1', '2', '3'], b: ['9'] });
  });
});

describe('drawing what has not come round', () => {
  it('takes the first draw when nothing is remembered', () => {
    let n = 0;
    expect(drawUnseen(() => n++, String, undefined)).toBe(0);
    expect(drawUnseen(() => n++, String, [])).toBe(1);
  });

  it('skips questions asked lately', () => {
    const draws = [1, 1, 2, 3];
    expect(drawUnseen(() => draws.shift()!, String, ['1'])).toBe(2);
  });

  it('takes the one asked longest ago when every draw was asked lately', () => {
    const pool = [3, 1, 2];
    let i = 0;
    expect(drawUnseen(() => pool[i++ % 3], String, ['1', '2', '3'])).toBe(1);
  });

  it('cycles through a small step before any question repeats', () => {
    const step = drillStep('numbers-10')!;
    let seen: DrillSeen = {};
    let previous: ReturnType<typeof drawQuestion> | undefined;
    const asked: string[] = [];
    // Seeded: a draw gives up after SEEN_TRIES, so with real randomness a round occasionally repeats (about 1 in 100).
    const random = seeded(7);
    for (let i = 0; i < 30; i++) {
      const q = drawQuestion(step, previous, random, 'th', undefined, seen[LIST]);
      asked.push(questionKey(q));
      seen = recordSeen(seen, LIST, questionKey(q));
      previous = q;
    }
    for (let round = 0; round < 3; round++) expect(new Set(asked.slice(round * 10, round * 10 + 10)).size).toBe(10);
  });

  it('never repeats within a step of 48 times in the 30 questions after one', () => {
    const step = drillStep('time-hours')!;
    for (let trial = 0; trial < 20; trial++) {
      let seen: DrillSeen = {};
      let previous: ReturnType<typeof drawQuestion> | undefined;
      const asked: string[] = [];
      for (let i = 0; i < 60; i++) {
        const q = drawQuestion(step, previous, Math.random, 'th', undefined, seen[LIST]);
        asked.push(questionKey(q));
        seen = recordSeen(seen, LIST, questionKey(q));
        previous = q;
      }
      for (let i = 0; i < asked.length; i++) expect(asked.slice(Math.max(0, i - 25), i)).not.toContain(asked[i]);
    }
  });
});

describe('a round drawn against what the step asked lately', () => {
  it('leaves out what the step asked lately, and repeats nothing within the round', () => {
    const step = drillStep('time-hours')!;
    for (let trial = 0; trial < 50; trial++) {
      const recent = Array.from({ length: 20 }, (_, i) => questionKey(drawQuestion(step, undefined, seeded(trial * 100 + i), 'th')));
      const round = drawRound(step, Math.random, 'th', undefined, recent).map(questionKey);
      expect(new Set(round).size).toBe(round.length);
      for (const k of round) expect(recent).not.toContain(k);
    }
  });
});

describe("a dates step's missed months", () => {
  it('keeps a miss until the month is had right, beside the asked list and apart from it', () => {
    const list = missedList('pl', 'dates-day');
    expect(list).not.toBe(seenList('pl', 'dates-day'));
    let seen = recordSeen(recordSeen({}, list, '3'), list, '7');
    expect(seen[list]).toEqual(['3', '7']);
    seen = forgetSeen(seen, list, '3');
    expect(seen[list]).toEqual(['7']);
    expect(forgetSeen(seen, list, '9')).toBe(seen);
    expect(forgetSeen(seen, list, '7')).toEqual({});
  });
});
