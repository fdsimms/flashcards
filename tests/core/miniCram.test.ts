import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterAnswer, afterReturn, cramLabel, CRAM_RETURNS, emptyMiniCram, markCram, MISSED_GAP, nextReturn, RETURN_GAPS, unmarkCram } from '../../src/core/miniCram';

const run = (s: ReturnType<typeof emptyMiniCram>, n: number, id = 'other') => { for (let i = 0; i < n; i++) s = afterAnswer(s, id, 3); return s; };

describe('mini cram', () => {
  it('starts its returns after the card is answered, not before', () => {
    let s = markCram(emptyMiniCram(), 'a', false);
    expect(nextReturn(run(s, 10), { ignoreWait: true })).toBeUndefined();
    s = afterAnswer(s, 'a', 3);
    expect(s.cards.a.based).toBe(true);
    expect(nextReturn(s, { ignoreWait: false })).toBeUndefined();
    expect(nextReturn(run(s, RETURN_GAPS[0]), { ignoreWait: false })).toBe('a');
  });

  it('marked after its answer, counts from now', () => {
    let s = run(emptyMiniCram(), 5);
    s = markCram(s, 'a', true);
    expect(nextReturn(run(s, RETURN_GAPS[0] - 1), { ignoreWait: false })).toBeUndefined();
    expect(nextReturn(run(s, RETURN_GAPS[0]), { ignoreWait: false })).toBe('a');
  });

  it('Got it uses up a return and spaces the next further out; the last one clears the card', () => {
    let s = afterAnswer(markCram(emptyMiniCram(), 'a', false), 'a', 3);
    for (let i = 1; i <= CRAM_RETURNS; i++) {
      s = run(s, 20);
      expect(nextReturn(s, { ignoreWait: false })).toBe('a');
      s = afterReturn(s, 'a', true);
    }
    expect(s.cards.a).toBeUndefined();
  });

  it('Missed it brings it back after MISSED_GAP and keeps the returns', () => {
    let s = afterAnswer(markCram(emptyMiniCram(), 'a', false), 'a', 3);
    s = afterReturn(run(s, 20), 'a', false);
    expect(s.cards.a.left).toBe(CRAM_RETURNS);
    expect(nextReturn(run(s, MISSED_GAP - 1), { ignoreWait: false })).toBeUndefined();
    expect(nextReturn(run(s, MISSED_GAP), { ignoreWait: false })).toBe('a');
  });

  it('a later real answer counts as a return unless it was Again', () => {
    let s = afterAnswer(markCram(emptyMiniCram(), 'a', false), 'a', 1);
    s = afterAnswer(s, 'a', 1);
    expect(s.cards.a.left).toBe(CRAM_RETURNS);
    s = afterAnswer(s, 'a', 3);
    expect(s.cards.a.left).toBe(CRAM_RETURNS - 1);
  });

  it('with nothing else queued it shows the soonest return, not the card just shown unless alone', () => {
    let s = afterAnswer(markCram(markCram(emptyMiniCram(), 'a', false), 'b', false), 'a', 3);
    s = afterAnswer(s, 'b', 3);
    expect(nextReturn(s, { ignoreWait: true, justShown: 'a' })).toBe('b');
    expect(nextReturn(unmarkCram(s, 'b'), { ignoreWait: true, justShown: 'a' })).toBe('a');
  });

  it('skips cards that are no longer usable', () => {
    const s = afterAnswer(markCram(emptyMiniCram(), 'a', false), 'a', 3);
    expect(nextReturn(s, { ignoreWait: true, usable: () => false })).toBeUndefined();
  });

  it('labels the chip', () => {
    const s = markCram(emptyMiniCram(), 'a', true);
    expect(cramLabel(s.cards.a, false)).toBe('Cram, 3 more');
    expect(cramLabel(s.cards.a, true)).toBe('Cram, 1 of 3');
    expect(cramLabel(undefined, false)).toBeUndefined();
  });

  it('imports nothing that answers, schedules or writes cards', () => {
    const code = readFileSync(join(__dirname, '..', '..', 'src/core/miniCram.ts'), 'utf8').split('\n').filter((l) => l.startsWith('import'));
    expect(code).toEqual([]);
  });
});
