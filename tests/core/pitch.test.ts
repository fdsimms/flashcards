import { describe, expect, it } from 'vitest';
import { pitchLine, pitchPath, pitchRange, showsPitch, toneCaption, trackPitch, type PitchPoint } from '../../src/core/pitch';

const RATE = 8000;

/** A voice-like tone: a fundamental at `hz(t)` with two quieter harmonics, for `seconds`. */
function tone(seconds: number, hz: (t: number) => number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    phase += (2 * Math.PI * hz(i / RATE)) / RATE;
    out[i] = amplitude * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
  }
  return out;
}

const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
const voiced = (points: PitchPoint[]) => points.filter((p): p is NonNullable<PitchPoint> => p !== null);

describe('tracking pitch', () => {
  it("finds a steady voice's pitch, a man's and a woman's", () => {
    for (const hz of [110, 220, 330]) {
      const track = trackPitch(tone(0.5, () => hz), RATE).filter((x): x is number => x !== null);
      expect(track.length).toBeGreaterThan(30);
      for (const found of track) expect(Math.abs(found - hz) / hz).toBeLessThan(0.02);
    }
  });

  it('hears nothing in silence, and leaves the quiet frames out', () => {
    expect(trackPitch(silence(0.5), RATE).every((x) => x === null)).toBe(true);
    const track = trackPitch(join(silence(0.2), tone(0.3, () => 200)), RATE);
    expect(track.slice(0, 10).every((x) => x === null)).toBe(true);
    expect(track.filter((x) => x !== null).length).toBeGreaterThan(20);
  });

  it('gives nothing for too short a clip to measure', () => {
    expect(trackPitch(tone(0.01, () => 200), RATE)).toEqual([]);
  });
});

describe('the line drawn', () => {
  it('draws a steady voice flat at its own middle, so two voices an octave apart line up', () => {
    for (const hz of [110, 220]) {
      const line = pitchLine(trackPitch(tone(0.5, () => hz), RATE))!;
      for (const p of voiced(line.points)) expect(Math.abs(p.semitones)).toBeLessThan(0.3);
    }
  });

  it('draws a fall as a fall and a rise as a rise', () => {
    const falling = pitchLine(trackPitch(tone(0.6, (t) => 260 - 150 * t), RATE))!;
    const rising = pitchLine(trackPitch(tone(0.6, (t) => 140 + 150 * t), RATE))!;
    const ends = (line: typeof falling) => { const v = voiced(line.points); return [v[2].semitones, v[v.length - 3].semitones]; };
    const [fallStart, fallEnd] = ends(falling);
    const [riseStart, riseEnd] = ends(rising);
    expect(fallStart - fallEnd).toBeGreaterThan(6);
    expect(riseEnd - riseStart).toBeGreaterThan(6);
    expect(falling.seconds).toBeGreaterThan(0.2);
  });

  it('keeps a gap where the voice stops, and trims the silence at either end', () => {
    const line = pitchLine(trackPitch(join(silence(0.1), tone(0.2, () => 200), silence(0.15), tone(0.2, () => 200), silence(0.1)), RATE))!;
    expect(line.points[0]).not.toBeNull();
    expect(line.points[line.points.length - 1]).not.toBeNull();
    expect(line.points.some((p) => p === null)).toBe(true);
    expect(pitchPath(line, 300, 120, 6).match(/M/g)!.length).toBe(2);
  });

  it('folds back an octave slip', () => {
    const track = Array.from({ length: 30 }, (_, i) => (i === 15 ? 400 : 200));
    for (const p of voiced(pitchLine(track)!.points)) expect(Math.abs(p.semitones)).toBeLessThan(1);
  });

  it('draws nothing for a take with too little voice', () => {
    expect(pitchLine([null, 200, 200, null])).toBeNull();
    expect(pitchLine([])).toBeNull();
  });

  it('scales the chart to fit both lines, within limits', () => {
    const flat = pitchLine(Array(20).fill(200))!;
    expect(pitchRange(flat, null)).toBe(6);
    const wide = { points: [{ t: 0, semitones: -9.2 }, { t: 1, semitones: 3 }], seconds: 1 };
    expect(pitchRange(flat, wide)).toBe(10);
    expect(pitchRange({ points: [{ t: 0, semitones: 20 }], seconds: 1 })).toBe(12);
    expect(pitchPath(wide, 300, 120, 10)).toBe('M0.0 115.2 L300.0 42.0');
  });
});

describe('where the line shows', () => {
  it('shows for the languages pitch tells words apart in, or every language with the setting on', () => {
    expect(showsPitch('th-TH', false)).toBe(true);
    expect(showsPitch('ja-JP', false)).toBe(true);
    expect(showsPitch('nb-NO', false)).toBe(true);
    expect(showsPitch('no-NO', false)).toBe(true);
    expect(showsPitch('pl-PL', false)).toBe(false);
    expect(showsPitch('pl-PL', true)).toBe(true);
    expect(showsPitch(undefined, true)).toBe(false);
  });
});

describe("a Thai word's tones under the chart", () => {
  it('names each syllable\'s tone from its romanization', () => {
    expect(toneCaption('khâao')).toBe('khâao · falling tone');
    expect(toneCaption('maa')).toBe('maa · mid tone');
    expect(toneCaption('phûu-yǐng')).toBe('phûu-yǐng · falling, rising');
    expect(toneCaption('  ')).toBeNull();
  });
});
