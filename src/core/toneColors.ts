/**
 * Thai tones for coloring a romanization, read from its tone marks as the notes write them
 * (phûu-yǐng, chǎn, nán): grave is low, circumflex falling, acute high, caron rising, and a
 * syllable with no mark is mid. Display only, never an input to anything. Pure, so it's tested.
 */

export type Tone = 'low' | 'falling' | 'high' | 'rising';

const MARKS: Record<string, Tone> = { '̀': 'low', '̂': 'falling', '́': 'high', '̌': 'rising' };

/** A syllable's tone, or undefined for mid (no mark) and for text with no vowel mark. */
export function toneOf(syllable: string): Tone | undefined {
  for (const ch of syllable.normalize('NFD')) if (MARKS[ch]) return MARKS[ch];
  return undefined;
}

export interface ToneSpan { text: string; tone?: Tone }

/**
 * `text` split into syllables (at hyphens and spaces, which stay with the syllable before them),
 * each with its tone. The pieces join back into exactly `text`.
 */
export function toneSpans(text: string): ToneSpan[] {
  return (text.match(/[^\s-]+[\s-]*|[\s-]+/gu) ?? []).map((piece) => ({ text: piece, tone: toneOf(piece) }));
}
