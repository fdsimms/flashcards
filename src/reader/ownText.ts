// A pasted text, before it's added to Read & Listen: the preview's lines in words (server/reader
// own_text.py makes the preview). Pure, so it's tested; the screen is src/ui/reader/ReadOwnText.tsx.
import { MAX_OWN_TEXT_CHARS, type OwnTextPreview } from './api';

/**
 * The share of known words a text Read & Listen writes is kept at or above (server/reader
 * coverage.py, FLOOR). A pasted text below it is harder than those, and the preview says so.
 */
export const WRITTEN_FLOOR = 0.9;

/** "1,240 of 30,000 characters", under the text field. */
export function charCount(length: number): string {
  return `${length.toLocaleString('en-US')} of ${MAX_OWN_TEXT_CHARS.toLocaleString('en-US')} characters`;
}

/** Whether the text is past what can be added, so the field can say so before it's sent. */
export const tooLong = (length: number): boolean => length > MAX_OWN_TEXT_CHARS;

/** "86%", the known share rounded down, so 89.6% isn't shown as reaching 90%. */
export function percentKnown(p: Pick<OwnTextPreview, 'coverage'>): string {
  return `${Math.floor(p.coverage * 100)}%`;
}

/** What the coverage means for reading it, when it's below what's written for the learner. */
export function coverageNote(p: Pick<OwnTextPreview, 'coverage'>): string | null {
  if (p.coverage >= WRITTEN_FLOOR) return null;
  return `Texts Read & Listen writes for you are at least ${Math.round(WRITTEN_FLOOR * 100)}%. Expect to look up a word in most lines.`;
}

/** "31 words you haven't studied", or that every word is known. */
export function newWordsTitle(p: Pick<OwnTextPreview, 'new_count'>): string {
  const n = p.new_count;
  if (n === 0) return 'You know every word in it';
  return `${n} ${n === 1 ? 'word' : 'words'} you haven't studied`;
}

/** How many of the new words the preview didn't list, for a last "+24" chip. */
export function moreNewWords(p: Pick<OwnTextPreview, 'new_count' | 'new_words'>): number {
  return Math.max(0, p.new_count - p.new_words.length);
}

/** "About 4 min" (at least a minute). */
export function listenTime(seconds: number): string {
  return `About ${Math.max(1, Math.round(seconds / 60))} min`;
}

/** "About $0.03", or "Less than a cent". */
export function costText(usd: number): string {
  if (usd < 0.005) return 'Less than a cent';
  return `About $${usd.toFixed(2)}`;
}

/** A long text's split, or null for one part: "It's split into 3 parts, each read on its own." */
export function partsNote(p: Pick<OwnTextPreview, 'parts'>): string | null {
  return p.parts > 1 ? `It's split into ${p.parts} parts, each read on its own, in order on your shelf.` : null;
}

/**
 * Whether a pasted text came back with no English at all: its translation failed on the server,
 * which still serves it (own_text.py), so the reader says so rather than leave the lines bare.
 */
export function untranslated(text: { reason?: string; lines: readonly { english: string }[] }): boolean {
  return text.reason === 'own' && text.lines.length > 0 && text.lines.every((l) => !l.english.trim());
}

/** What the reader says about it. */
export const UNTRANSLATED_NOTE = "This text has no English translation: translating it didn't work. Tap a word for its meaning, or Explain a line.";
