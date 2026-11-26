// The pitch line in Record yourself: a take's pitch over the card recording's, to see where a tone or a
// pitch accent went the other way. Measured on the phone from plain samples (modules/audio-samples
// decodes the files), never sent anywhere, and never a score: Score it was removed because a number
// that can't tell a wrong tone from a right one is worse than none (architecture.md, Speaking). Pure,
// so it's tested; the chart is src/ui/PitchLine.tsx.
import { toneSpans } from './toneColors';

/** The languages a word's pitch tells words apart in, where the line is shown by default: Thai's tones, Japanese pitch accent (箸, 橋), Norwegian's two word tones. */
export const PITCH_LANGUAGES = ['th', 'ja', 'nb'] as const;

/** Whether the line is shown for a card in `speechLang` (th-TH), or for every language with the setting on. */
export function showsPitch(speechLang: string | undefined, everyLanguage: boolean): boolean {
  if (!speechLang) return false;
  const code = speechLang.toLowerCase().split('-')[0];
  return everyLanguage || (PITCH_LANGUAGES as readonly string[]).includes(code === 'no' ? 'nb' : code);
}

export interface PitchOptions {
  /** The lowest and highest pitch looked for, in Hz: a low man's voice to a high woman's. */
  minHz: number;
  maxHz: number;
  /** Each measurement's window, and the step between measurements, in seconds. */
  frameSeconds: number;
  hopSeconds: number;
  /** YIN's threshold: lower asks for a clearer pitch before a frame counts as voiced. */
  threshold: number;
  /** A frame quieter than this share of the loudest frame is silence (or breath), not voice. */
  quiet: number;
}

export const PITCH_DEFAULTS: PitchOptions = { minHz: 70, maxHz: 450, frameSeconds: 0.04, hopSeconds: 0.01, threshold: 0.15, quiet: 0.1 };

/**
 * The pitch at each step through `samples`, in Hz, or null where there's no voice (silence, breath,
 * a consonant): YIN (de Cheveigné and Kawahara, 2002), the difference function normalized by its
 * running mean, the first dip under the threshold, refined between samples by a parabola.
 */
export function trackPitch(samples: ArrayLike<number>, sampleRate: number, options: Partial<PitchOptions> = {}): (number | null)[] {
  const o = { ...PITCH_DEFAULTS, ...options };
  const window = Math.round(o.frameSeconds * sampleRate);
  const hop = Math.max(1, Math.round(o.hopSeconds * sampleRate));
  const tauMin = Math.max(2, Math.floor(sampleRate / o.maxHz));
  const tauMax = Math.ceil(sampleRate / o.minHz);
  const starts: number[] = [];
  for (let s = 0; s + window + tauMax <= samples.length; s += hop) starts.push(s);
  if (!starts.length) return [];

  const rms = starts.map((s) => {
    let sum = 0;
    for (let j = 0; j < window; j++) sum += samples[s + j] * samples[s + j];
    return Math.sqrt(sum / window);
  });
  const loudest = Math.max(...rms);
  if (loudest === 0) return starts.map(() => null);

  const d = new Float64Array(tauMax + 1);
  return starts.map((s, f) => {
    if (rms[f] < o.quiet * loudest) return null;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < window; j++) {
        const diff = samples[s + j] - samples[s + j + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Cumulative mean normalized difference, in place.
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
    }
    let tau = tauMin;
    while (tau <= tauMax && d[tau] >= o.threshold) tau++;
    if (tau > tauMax) return null;
    while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
    // A parabola through the dip and its neighbors, for a lag between samples.
    const a = d[tau - 1];
    const b = d[tau];
    const c = tau + 1 <= tauMax ? d[tau + 1] : b;
    const bend = a - 2 * b + c;
    const refined = bend > 0 ? tau + (a - c) / (2 * bend) : tau;
    return sampleRate / refined;
  });
}

/** One point of a line: where through the voiced stretch (0 to 1), and how far above or below the speaker's middle pitch, in semitones. Null breaks the line (a gap in the voice). */
export type PitchPoint = { t: number; semitones: number } | null;

export interface PitchLine {
  points: PitchPoint[];
  /** How long the voiced stretch lasts, in seconds. */
  seconds: number;
}

/** Fewer voiced steps than this (80 ms) isn't a pitch worth drawing. */
const MIN_VOICED = 8;
/** A step further than this from the middle pitch is a tracking slip by an octave, folded back. */
const OCTAVE_SLIP = 9;

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * A track as a line to draw: semitones from the speaker's own middle pitch (so a man's voice and a
 * woman's line up), an octave slip folded back, smoothed over five steps, from the first voiced step
 * to the last, with gaps where the voice stops. Null when too little was voiced to draw.
 */
export function pitchLine(track: readonly (number | null)[], hopSeconds = PITCH_DEFAULTS.hopSeconds): PitchLine | null {
  const voiced = track.filter((hz): hz is number => hz !== null && hz > 0);
  if (voiced.length < MIN_VOICED) return null;
  const middle = median(voiced);
  const first = track.findIndex((hz) => hz !== null);
  let last = track.length - 1;
  while (last > first && track[last] === null) last--;
  const raw = track.slice(first, last + 1).map((hz) => {
    if (hz === null) return null;
    let st = 12 * Math.log2(hz / middle);
    while (st > OCTAVE_SLIP) st -= 12;
    while (st < -OCTAVE_SLIP) st += 12;
    return st;
  });
  const span = Math.max(1, raw.length - 1);
  const points = raw.map((st, i): PitchPoint => {
    if (st === null) return null;
    const near = raw.slice(Math.max(0, i - 2), i + 3).filter((x): x is number => x !== null);
    return { t: i / span, semitones: median(near) };
  });
  return { points, seconds: (last - first) * hopSeconds };
}

/** How many semitones above and below the middle a chart of these lines shows: room for both, at least 6, at most 12. */
export function pitchRange(...lines: (PitchLine | null)[]): number {
  let most = 0;
  for (const line of lines) for (const p of line?.points ?? []) if (p) most = Math.max(most, Math.abs(p.semitones));
  return Math.min(12, Math.max(6, Math.ceil(most)));
}

/** An SVG path for a line on a `width` by `height` chart, the middle pitch across its middle; a gap starts a new stroke. */
export function pitchPath(line: PitchLine, width: number, height: number, range: number): string {
  const parts: string[] = [];
  let pen = false;
  for (const p of line.points) {
    if (!p) { pen = false; continue; }
    const x = p.t * width;
    const y = height / 2 - (Math.max(-range, Math.min(range, p.semitones)) / range) * (height / 2);
    parts.push(`${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
    pen = true;
  }
  return parts.join(' ');
}

/**
 * A Thai word's tones as the chart's caption, read from its romanization's tone marks (toneColors.ts):
 * "khâao · falling tone", "phûu-yǐng · falling, rising". Null for no romanization.
 */
export function toneCaption(roman: string): string | null {
  const text = roman.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const tones = toneSpans(text).filter((s) => /\p{L}/u.test(s.text)).map((s) => s.tone ?? 'mid');
  if (!tones.length) return null;
  return `${text} · ${tones.length === 1 ? `${tones[0]} tone` : tones.join(', ')}`;
}
