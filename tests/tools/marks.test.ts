import { describe, expect, it } from 'vitest';
import { CANDIDATES, FADE_DAYS, MAX_MISSES, markList, parseMarks, pickWeighted, recordMark, weightOf, type Marks } from '../../src/tools/marks';

const NOW = new Date(2026, 10, 13, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;
const LIST = markList('time', 'th');

const sequence = (...values: number[]) => () => values.shift() ?? 0;

describe('recording an answer', () => {
  it('adds a miss to each of the question’s patterns, and a right answer takes one off', () => {
    let marks = recordMark({}, LIST, ['band:thum', 'minutes:to'], false, NOW);
    marks = recordMark(marks, LIST, ['band:thum', 'minutes:past'], false, NOW);
    expect(marks[LIST]).toEqual({ 'band:thum': { misses: 2, at: NOW }, 'minutes:to': { misses: 1, at: NOW }, 'minutes:past': { misses: 1, at: NOW } });
    marks = recordMark(marks, LIST, ['band:thum', 'minutes:to'], true, NOW + 1);
    expect(marks[LIST]).toEqual({ 'band:thum': { misses: 1, at: NOW + 1 }, 'minutes:past': { misses: 1, at: NOW } });
  });

  it('counts at most MAX_MISSES', () => {
    let marks: Marks = {};
    for (let i = 0; i < MAX_MISSES + 3; i++) marks = recordMark(marks, LIST, ['band:thum'], false, NOW);
    expect(marks[LIST]['band:thum'].misses).toBe(MAX_MISSES);
  });

  it('keeps nothing for a right answer to a pattern never missed', () => {
    expect(recordMark({}, LIST, ['band:thum'], true, NOW)).toEqual({});
  });

  it('counts a pattern given twice once', () => {
    expect(recordMark({}, LIST, ['a', 'a'], false, NOW)[LIST].a.misses).toBe(1);
  });

  it('keeps each tool and language apart', () => {
    const marks = recordMark({}, markList('time', 'pl'), ['hour:7'], false, NOW);
    expect(recordMark(marks, LIST, ['band:thum'], false, NOW)[markList('time', 'pl')]).toEqual({ 'hour:7': { misses: 1, at: NOW } });
  });

  it('drops a faded tally from the list it writes to', () => {
    const old = recordMark({}, LIST, ['band:dtii'], false, NOW - FADE_DAYS * DAY);
    expect(recordMark(old, LIST, ['band:thum'], false, NOW)[LIST]).toEqual({ 'band:thum': { misses: 1, at: NOW } });
  });
});

describe('a question’s weight', () => {
  const tallies = { 'band:thum': { misses: 2, at: NOW }, 'minutes:to': { misses: 1, at: NOW } };

  it('is 1 plus its patterns’ misses', () => {
    expect(weightOf(tallies, ['band:chao', 'minutes:oclock'], NOW)).toBe(1);
    expect(weightOf(tallies, ['band:thum', 'minutes:past'], NOW)).toBe(3);
  });

  it('is at most 1 + MAX_MISSES', () => {
    expect(weightOf({ ...tallies, 'band:thum': { misses: 3, at: NOW } }, ['band:thum', 'minutes:to'], NOW)).toBe(1 + MAX_MISSES);
  });

  it('leaves out misses that have faded', () => {
    expect(weightOf(tallies, ['band:thum'], NOW + (FADE_DAYS - 1) * DAY)).toBe(3);
    expect(weightOf(tallies, ['band:thum'], NOW + FADE_DAYS * DAY)).toBe(1);
  });
});

describe('picking the next question', () => {
  const patternsOf = (n: number) => [n % 2 ? 'odd' : 'even'];

  it('is the tool’s own pick, untouched, when nothing has been missed', () => {
    const draws = [5, 6, 7];
    expect(pickWeighted(() => draws.shift()!, patternsOf, undefined, NOW, () => 0.99)).toBe(5);
    expect(draws).toEqual([6, 7]);
  });

  it('draws CANDIDATES and chooses in proportion to weight', () => {
    // Weights 1, 4, 1, 1 (odd missed 3 times): a third of the way through 7 lands on the 4.
    const tallies = { odd: { misses: 3, at: NOW } };
    const draw = sequence(2, 3, 4, 6);
    expect(pickWeighted(draw, patternsOf, tallies, NOW, () => 2 / 7)).toBe(3);
    expect(pickWeighted(sequence(2, 3, 4, 6), patternsOf, tallies, NOW, () => 0)).toBe(2);
    expect(pickWeighted(sequence(2, 3, 4, 6), patternsOf, tallies, NOW, () => 0.9999)).toBe(6);
    expect(CANDIDATES).toBe(4);
  });

  it('comes up with missed patterns more often, but not only them', () => {
    let n = 0;
    const draw = () => n++ % 10;
    const tallies = { odd: { misses: 3, at: NOW } };
    let odd = 0;
    for (let i = 0; i < 2000; i++) odd += pickWeighted(draw, patternsOf, tallies, NOW) % 2;
    expect(odd / 2000).toBeGreaterThan(0.6);
    expect(odd / 2000).toBeLessThan(0.95);
  });
});

describe('reading the stored tallies', () => {
  it('reads what was written', () => {
    const marks = recordMark({}, LIST, ['band:thum'], false, NOW);
    expect(parseMarks(JSON.stringify(marks))).toEqual(marks);
  });

  it('drops anything unreadable', () => {
    expect(parseMarks(null)).toEqual({});
    expect(parseMarks('not json')).toEqual({});
    expect(parseMarks('[1]')).toEqual({});
    expect(parseMarks(JSON.stringify({
      a: { ok: { misses: 9, at: NOW }, zero: { misses: 0, at: NOW }, half: { misses: 1.5, at: NOW }, noAt: { misses: 1 } },
      b: 'x',
      c: {},
    }))).toEqual({ a: { ok: { misses: MAX_MISSES, at: NOW } } });
  });
});
