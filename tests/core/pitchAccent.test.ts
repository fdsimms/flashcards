import { describe, expect, it } from 'vitest';
import type { PitchLine } from '../../src/core/pitch';
import { MAX_MORAE, accentCheck, accentCheckLabel, accentPattern, accentReading, dropOf, morae } from '../../src/core/pitchAccent';

/** A pitch line holding each mora at a level (semitones), `per` points each; null for a mora with no voice. */
function line(levels: (number | null)[], per = 10): PitchLine {
  const n = levels.length * per;
  return {
    seconds: n / 100,
    points: Array.from({ length: n }, (_, k) => {
      const level = levels[Math.floor(k / per)];
      return level === null ? null : { t: k / (n - 1), semitones: level };
    }),
  };
}

describe('pitch accent', () => {
  it('splits a reading into morae, small kana joining the one before', () => {
    expect(morae('きょうと')).toEqual(['きょ', 'う', 'と']);
    expect(morae('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
    expect(morae('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー']);
    expect(morae('しんぶん')).toEqual(['し', 'ん', 'ぶ', 'ん']);
    expect(morae('卵')).toEqual([]);
  });

  it("reads the note's KanaReading, else a kana Entry, of 2 to 8 morae", () => {
    expect(accentReading({ fields: { Entry: '卵', KanaReading: 'たまご' } })).toEqual(['た', 'ま', 'ご']);
    expect(accentReading({ fields: { Entry: 'たまご', KanaReading: '' } })).toEqual(['た', 'ま', 'ご']);
    expect(accentReading({ fields: { Entry: '卵', KanaReading: '' } })).toEqual([]);
    expect(accentReading({ fields: { Entry: 'き', KanaReading: '' } })).toEqual([]);
    expect(accentReading({ fields: { Entry: 'x', KanaReading: 'あ'.repeat(MAX_MORAE + 1) } })).toEqual([]);
  });

  it('finds the drop after the last high mora, or none in a flat word', () => {
    // たまꜜご: low, high, then down.
    expect(dropOf(line([-2, 2, -3]), 3)).toBe(1);
    // あꜜめ (rain): high then down.
    expect(dropOf(line([3, -2]), 2)).toBe(0);
    // さくら, flat: up after the first and level, a little lower at the end of the word.
    expect(dropOf(line([-2, 1, 0]), 3)).toBeNull();
    // A mora said without voice is passed over.
    expect(dropOf(line([-2, 2, null, -3]), 4)).toBe(1);
    expect(dropOf(line([1, null, null]), 3)).toBeUndefined();
  });

  it('pairs each mora high or low as Tokyo Japanese does for the drop', () => {
    expect(accentPattern(3, 1)).toEqual(['low', 'high', 'low']);
    expect(accentPattern(2, 0)).toEqual(['high', 'low']);
    expect(accentPattern(3, null)).toEqual(['low', 'high', 'high']);
    expect(accentPattern(3, 2)).toEqual(['low', 'high', 'high']);
  });

  it('compares the take with the recording and says what it found', () => {
    const split = ['た', 'ま', 'ご'];
    const flat = accentCheck(line([-2, 2, -3]), line([-2, 1, 1]), split);
    expect(flat).toMatchObject({ recording: 1, yours: null, verdict: 'different' });
    expect(accentCheckLabel(flat)).toBe('Different: the recording drops after ま. Yours stays up.');
    const same = accentCheck(line([-2, 2, -3]), line([-1, 3, -1]), split);
    expect(accentCheckLabel(same)).toBe('Same: both drop after ま.');
    const unheard = accentCheck(line([-2, 2, -3]), line([1, null, null]), split);
    expect(unheard.verdict).toBe('unclear');
    expect(accentCheckLabel(unheard)).toBe('Pitch not clear enough to say.');
    expect(accentCheckLabel(accentCheck(line([-2, 1, 1]), line([-2, 1, 0]), split))).toBe('Same: neither drops inside the word.');
  });

  it('imports nothing that schedules or writes a card', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../src/core/pitchAccent.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(scheduler|session|writeQueue)'|anki\//);
  });
});
