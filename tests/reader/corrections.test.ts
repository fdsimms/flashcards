import { describe, expect, it } from 'vitest';
import type { SituationFeedback } from '../../src/reader/api';
import { keep, keepable, keptLines, KEPT_DAYS, KEPT_LINE_CHARS, KEPT_LINES_MAX, MAX_KEPT, parseKept, type KeptCorrection } from '../../src/reader/corrections';

const NOW = new Date(2026, 10, 19, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;
const feedback = (lines: SituationFeedback['lines']): SituationFeedback => ({ lines, words: [] });
const kept = (said: string, at = NOW, over: Partial<KeptCorrection> = {}): KeptCorrection => ({ language: 'th', said, corrected: `${said}!`, note: '', at, ...over });

describe('keepable', () => {
  const mine = new Map([[1, 'ฉันสั่งอาหารสอง'], [3, 'เผ็ดมาก'], [5, 'อร่อยมากมาก'], [7, '  spaced   out ']]);
  it('takes the lines that were not right and have a different correction', () => {
    const got = keepable(feedback([
      { index: 1, verdict: 'wrong', corrected: 'ฉันสั่งอาหารสองจาน', note: 'Add the classifier.' },
      { index: 3, verdict: 'right', corrected: 'เผ็ดมาก', note: 'Good.' },
      { index: 5, verdict: 'almost', corrected: 'อร่อยมาก', note: 'One is enough.' },
      { index: 7, verdict: 'almost', corrected: 'spaced out', note: 'Same words.' },
      { index: 9, verdict: 'wrong', corrected: 'x', note: 'No such line.' },
      { index: 5, verdict: 'wrong', corrected: ' ', note: 'Nothing to keep.' },
    ]), mine);
    expect(got).toEqual([
      { said: 'ฉันสั่งอาหารสอง', corrected: 'ฉันสั่งอาหารสองจาน', note: 'Add the classifier.' },
      { said: 'อร่อยมากมาก', corrected: 'อร่อยมาก', note: 'One is enough.' },
    ]);
    expect(keepable(feedback([]), mine)).toEqual([]);
  });
});

describe('keep', () => {
  it('puts the new ones first, once each, and stamps them', () => {
    const list = keep([kept('a', NOW - DAY)], 'th', [{ said: 'b', corrected: 'b!', note: 'n' }, { said: 'a', corrected: 'a!', note: '' }], NOW);
    expect(list.map((c) => [c.said, c.at])).toEqual([['b', NOW], ['a', NOW]]);
    expect(list[0].language).toBe('th');
  });
  it('treats the same line in another language as another', () => {
    const list = keep([kept('a', NOW - DAY, { language: 'pl' })], 'th', [{ said: 'a', corrected: 'a!', note: '' }], NOW);
    expect(list.map((c) => c.language)).toEqual(['th', 'pl']);
  });
  it('drops what is older than the limit and keeps to the most', () => {
    const old = kept('old', NOW - KEPT_DAYS * DAY);
    const recent = kept('recent', NOW - (KEPT_DAYS - 1) * DAY);
    expect(keep([old, recent], 'th', [], NOW).map((c) => c.said)).toEqual(['recent']);
    const many = Array.from({ length: MAX_KEPT + 5 }, (_, i) => kept(`line ${i}`, NOW - i * 1000));
    expect(keep(many, 'th', [], NOW)).toHaveLength(MAX_KEPT);
  });
});

describe('keptLines', () => {
  it("tells the theme request the language's newest corrections, within the limit", () => {
    const list = [kept('old one', NOW - 5 * DAY), ...Array.from({ length: 6 }, (_, i) => kept(`new ${i}`, NOW - i * 1000)), kept('polish', NOW, { language: 'pl' }), kept('faded', NOW - 90 * DAY)];
    const lines = keptLines(list, 'th', NOW);
    expect(lines).toHaveLength(KEPT_LINES_MAX);
    expect(lines[0]).toBe('Mistake in a rehearsal: said "new 0", corrected to "new 0!"');
    expect(lines.join('')).not.toMatch(/polish|faded|old one/);
    expect(keptLines([], 'th', NOW)).toEqual([]);
  });
  it('keeps each line within what the server takes', () => {
    expect(keptLines([kept('x'.repeat(300))], 'th', NOW)[0]).toHaveLength(KEPT_LINE_CHARS);
  });
});

describe('parseKept', () => {
  it('reads a saved list and drops what is not a correction', () => {
    const good = kept('a');
    expect(parseKept(JSON.parse(JSON.stringify([good, { said: 'x' }, 4, null])))).toEqual([good]);
    expect(parseKept(null)).toEqual([]);
    expect(parseKept({})).toEqual([]);
  });
});
