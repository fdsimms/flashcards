import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PitchLine, PitchPoint } from '../../src/core/pitch';
import { shapeOf, shapeName, syllableStretches, thaiSyllables, toneCheck, toneCheckLabel } from '../../src/core/toneCheck';

/** A syllable's points: `count` steps from `from` to `to` semitones, optionally dipping in the middle. */
function syllable(from: number, to: number, count = 20, dip = 0): number[] {
  return Array.from({ length: count }, (_, i) => {
    const x = i / (count - 1);
    return from + (to - from) * x - dip * Math.sin(Math.PI * x);
  });
}

/** A line of syllables, with a gap in the voice between each when `gaps`. */
function line(parts: number[][], gaps = true): PitchLine {
  const raw: (number | null)[] = [];
  parts.forEach((p, i) => {
    if (i && gaps) raw.push(null, null, null);
    raw.push(...p);
  });
  const span = raw.length - 1;
  const points: PitchPoint[] = raw.map((st, i) => (st === null ? null : { t: i / span, semitones: st }));
  return { points, seconds: raw.length / 100 };
}

const run = (values: number[]) => values.map((semitones, i) => ({ t: i / values.length, semitones }));

describe('tone check', () => {
  it("names a syllable's shape around the speaker's middle", () => {
    expect(shapeOf(run(syllable(3, -3)))).toBe('falling');
    expect(shapeOf(run(syllable(-1, 3)))).toBe('rising');
    // Thai's rising tone dips before it rises.
    expect(shapeOf(run(syllable(0, 1.2, 20, 3)))).toBe('rising');
    expect(shapeOf(run(syllable(2.5, 2.8)))).toBe('high');
    expect(shapeOf(run(syllable(-2.5, -2.2)))).toBe('low');
    expect(shapeOf(run(syllable(0.2, -0.3)))).toBe('mid');
    expect(shapeOf(run(syllable(3, -3, 4)))).toBeNull();
  });

  it("cuts a line at its gaps when there's one per syllable, else into equal stretches", () => {
    const parted = line([syllable(3, -3), syllable(-2, -2)]);
    expect(syllableStretches(parted, 2).map((r) => r.length)).toEqual([20, 20]);
    const joined = line([syllable(3, -3), syllable(-2, -2)], false);
    expect(syllableStretches(joined, 2).map((r) => r.length)).toEqual([20, 20]);
    expect(syllableStretches(parted, 0)).toEqual([]);
  });

  it('compares each syllable of the take with the recording, saying when it can\'t tell', () => {
    const recording = line([syllable(3, -3), syllable(-2.5, -2.2)]);
    const yours = line([syllable(2.5, -3), syllable(0.1, 0.3)]);
    const checks = toneCheck(recording, yours, ['mâi', 'mài']);
    expect(checks).toEqual([
      { syllable: 'mâi', recording: 'falling', yours: 'falling', verdict: 'same' },
      { syllable: 'mài', recording: 'low', yours: 'mid', verdict: 'different' },
    ]);
    expect(toneCheckLabel(checks)).toBe('mâi: falling, yours falling, the same. mài: low, yours mid, different');
    const quiet = toneCheck(recording, line([syllable(2.5, -3), syllable(0, 0, 3)]), ['mâi', 'mài']);
    expect(quiet[1].verdict).toBe('unclear');
    expect(toneCheckLabel(quiet)).toContain("mài: the pitch wasn't clear enough to say");
    expect(shapeName('falling')).toBe('Falling');
  });

  it("takes a Thai word's syllables from its romanization", () => {
    expect(thaiSyllables('phûu-yǐng')).toEqual(['phûu', 'yǐng']);
    expect(thaiSyllables(' mâi  mài ')).toEqual(['mâi', 'mài']);
    expect(thaiSyllables('')).toEqual([]);
  });

  it('imports nothing that schedules or writes a card', () => {
    const imports = readFileSync(join(__dirname, '..', '..', 'src/core/toneCheck.ts'), 'utf8').split('\n').filter((l) => l.startsWith('import'));
    expect(imports.filter((l) => /scheduler|session|writeback|noteService|\/db\//.test(l))).toEqual([]);
  });
});
