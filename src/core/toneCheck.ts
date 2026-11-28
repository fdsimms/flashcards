// The tone check under Record yourself's pitch line (docs/read-and-listen/architecture.md, Speaking,
// "Tone check"): for a Thai word, each syllable's tone shape in the card's recording and in the
// take, and whether they match. It compares the take with the recording, not with a textbook shape,
// since real speech bends tones (a final syllable's high tone often rises; a falling one can start
// level). A guide and never a score, and never a rating: nothing here reaches a card. It reads the
// lines pitch.ts already drew, so nothing new is measured or sent. Pure, so it's tested.
import type { PitchLine, PitchPoint } from './pitch';
import { toneSpans } from './toneColors';

/** A syllable's shape: Thai's five tones as a pitch line looks, around the speaker's own middle. */
export type ToneShape = 'mid' | 'low' | 'high' | 'falling' | 'rising';

export type SyllableCheck = {
  syllable: string;
  /** The recording's shape and the take's; null where too little pitch was heard to say. */
  recording: ToneShape | null;
  yours: ToneShape | null;
  /** 'same', 'different', or 'unclear' when either couldn't be read. */
  verdict: 'same' | 'different' | 'unclear';
};

/** Fewer voiced points than this in a syllable (60 ms) is too little to name a shape. */
const MIN_POINTS = 6;
/** A rise or fall of more than this many semitones across a syllable is a contour, not a level tone. */
const CONTOUR = 2;
/** A level syllable this far above or below the speaker's middle is high or low, not mid. */
const LEVEL = 1.5;

type Run = { t: number; semitones: number }[];

/** The line's voiced runs: the stretches between gaps in the voice. */
function runs(points: readonly PitchPoint[]): Run[] {
  const out: Run[] = [];
  let current: Run = [];
  for (const p of points) {
    if (p) { current.push(p); continue; }
    if (current.length) out.push(current);
    current = [];
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * The line cut into `count` syllables: its voiced runs when there are as many runs as syllables
 * (a gap in the voice between each, as a stop consonant makes), else equal stretches of the line.
 */
export function syllableStretches(line: PitchLine, count: number): Run[] {
  if (count < 1) return [];
  const voiced = runs(line.points);
  if (voiced.length === count) return voiced;
  const all = voiced.flat();
  return Array.from({ length: count }, (_, i) => all.filter((p) => p.t >= i / count && (i === count - 1 ? p.t <= 1 : p.t < (i + 1) / count)));
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A syllable's shape from its pitch, or null for too little voice to say. */
export function shapeOf(run: Run): ToneShape | null {
  if (run.length < MIN_POINTS) return null;
  const quarter = Math.max(2, Math.floor(run.length / 4));
  const start = mean(run.slice(0, quarter).map((p) => p.semitones));
  const end = mean(run.slice(-quarter).map((p) => p.semitones));
  const values = run.map((p) => p.semitones);
  const lowest = Math.min(...values);
  const lowAt = values.indexOf(lowest) / (values.length - 1);
  const rise = end - start;
  // Thai's rising tone dips first, so a syllable that dips in its middle and ends well above that dip rises too.
  if (rise > CONTOUR || (end > start && end - lowest > CONTOUR && lowAt > 0.15 && lowAt < 0.85)) return 'rising';
  if (rise < -CONTOUR) return 'falling';
  const level = mean(run.map((p) => p.semitones));
  if (level > LEVEL) return 'high';
  if (level < -LEVEL) return 'low';
  return 'mid';
}

/** Each syllable's shape in the recording and the take, and whether they match. */
export function toneCheck(recording: PitchLine, yours: PitchLine, syllables: readonly string[]): SyllableCheck[] {
  const theirs = syllableStretches(recording, syllables.length);
  const mine = syllableStretches(yours, syllables.length);
  return syllables.map((syllable, i) => {
    const a = theirs[i] ? shapeOf(theirs[i]) : null;
    const b = mine[i] ? shapeOf(mine[i]) : null;
    return { syllable, recording: a, yours: b, verdict: a === null || b === null ? 'unclear' : a === b ? 'same' : 'different' };
  });
}

/** A Thai word's syllables from its romanization (phûu-yǐng: phûu, yǐng), as the chart's caption splits them. */
export function thaiSyllables(roman: string): string[] {
  return toneSpans(roman.replace(/\s+/g, ' ').trim())
    .map((s) => s.text.replace(/[\s-]+$/u, ''))
    .filter((s) => /\p{L}/u.test(s));
}

/** How a shape is said: "Falling", "Low". */
export const shapeName = (shape: ToneShape): string => shape[0].toUpperCase() + shape.slice(1);

/** The checks in one sentence for VoiceOver: "mâi: falling, yours falling, the same. mài: low, yours mid, different." */
export function toneCheckLabel(checks: readonly SyllableCheck[]): string {
  return checks
    .map((c) => (c.verdict === 'unclear'
      ? `${c.syllable}: the pitch wasn't clear enough to say`
      : `${c.syllable}: ${c.recording}, yours ${c.yours}, ${c.verdict === 'same' ? 'the same' : 'different'}`))
    .join('. ');
}
