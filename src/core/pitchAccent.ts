// The pitch accent check under Record yourself's pitch line (docs/read-and-listen/architecture.md,
// Speaking, "Pitch accent check"): for a Japanese word, where the pitch drops in the card's recording
// and in the take, mora by mora, and whether they drop in the same place. Like the Thai tone check
// (toneCheck.ts) it compares the take with the recording, since no note carries an accent pattern, and
// it is a guide, never a score or a rating: nothing here reaches a card. It reads the lines pitch.ts
// already drew. Pure, so it's tested.
import { htmlToText } from './html';
import { isKana } from './kana';
import type { PitchLine } from './pitch';
import { syllableStretches } from './toneCheck';
import type { Note } from './types';

/** Longer words and phrases are read too unreliably to say where they drop. */
export const MAX_MORAE = 8;
/** A fall of at least this many semitones from one mora to the next is the accent's drop. */
const DROP = 2.5;
/** Fewer voiced points than this (30 ms) in a mora is too little to place it. */
const MIN_POINTS = 3;

// Small kana that join the mora before them (きゃ is one mora); っ, ん and ー are morae of their own.
const SMALL = /^[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]$/;

/** A kana reading split into morae: きょうと, kyo-u-to. Empty when it isn't all kana. */
export function morae(kana: string): string[] {
  const text = kana.replace(/[\s・]+/g, '');
  if (!text || !isKana(text)) return [];
  const out: string[] = [];
  for (const ch of text) {
    if (SMALL.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

/** A Japanese note's reading to check: its KanaReading, or the Entry when it's written in kana; 2 to `MAX_MORAE` morae, else none. */
export function accentReading(note: Pick<Note, 'fields'>): string[] {
  const reading = htmlToText(note.fields.KanaReading ?? '').trim() || htmlToText(note.fields.Entry ?? '').trim();
  const split = morae(reading);
  return split.length >= 2 && split.length <= MAX_MORAE ? split : [];
}

/**
 * Where the pitch drops in a line cut into `count` morae: the index of the last high mora before the
 * fall, null for no drop inside the word, or undefined when too few morae could be heard to say.
 * Morae with no voice (っ, or a vowel said without voice, as in です) are passed over, and the drop
 * placed after the last one heard before it.
 */
export function dropOf(line: PitchLine, count: number): number | null | undefined {
  const levels = syllableStretches(line, count).map((run) => (run.length >= MIN_POINTS ? run.reduce((sum, p) => sum + p.semitones, 0) / run.length : null));
  const heard = levels.flatMap((level, i) => (level === null ? [] : [{ i, level }]));
  if (heard.length < 2) return undefined;
  let drop: number | null = null;
  let biggest = DROP;
  for (let k = 1; k < heard.length; k++) {
    const fall = heard[k - 1].level - heard[k].level;
    if (fall >= biggest) { biggest = fall; drop = heard[k - 1].i; }
  }
  return drop;
}

/** Each mora high or low for a drop after mora `drop` (null for none), as Tokyo Japanese pairs them. */
export function accentPattern(count: number, drop: number | null): ('high' | 'low')[] {
  return Array.from({ length: count }, (_, i) => {
    if (drop === 0) return i === 0 ? 'high' : 'low';
    if (i === 0) return 'low';
    return drop === null || i <= drop ? 'high' : 'low';
  });
}

export type AccentCheck = {
  morae: string[];
  /** Where each drops: the last high mora, null for no drop in the word, undefined where it couldn't be heard. */
  recording: number | null | undefined;
  yours: number | null | undefined;
  verdict: 'same' | 'different' | 'unclear';
};

/** Where the recording and the take drop, and whether it's the same place. */
export function accentCheck(recording: PitchLine, yours: PitchLine, split: readonly string[]): AccentCheck {
  const a = dropOf(recording, split.length);
  const b = dropOf(yours, split.length);
  return { morae: [...split], recording: a, yours: b, verdict: a === undefined || b === undefined ? 'unclear' : a === b ? 'same' : 'different' };
}

const where = (split: readonly string[], drop: number | null): string => (drop === null ? 'stays up' : `drops after ${split[drop]}`);

/** What the check found, in a sentence: shown under the two rows, and read by VoiceOver. */
export function accentCheckLabel(check: AccentCheck): string {
  const { morae: split, recording, yours, verdict } = check;
  if (recording === undefined || yours === undefined) return 'Pitch not clear enough to say.';
  if (verdict === 'same') return recording === null ? 'Same: neither drops inside the word.' : `Same: both drop after ${split[recording]}.`;
  return `Different: the recording ${where(split, recording)}. Yours ${where(split, yours)}.`;
}
