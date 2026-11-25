import { headword } from './forms';
import { htmlToText } from './html';
import type { Note } from './types';

/**
 * What Review puts on screen right after a card is answered Again and its note has a Mnemonic:
 * the word, its meaning and the mnemonic, held until the learner continues. Only reminds; it
 * never reads or changes a rating or a schedule.
 */
export interface MissMnemonic {
  word: string;
  meaning: string;
  mnemonic: string;
}

/**
 * The reminder for an answer, or undefined when there's nothing to show: any rating but Again, a
 * filtered deck's preview (nothing was forgotten), or a note with no Mnemonic text.
 */
export function missMnemonic(note: Note, rating: number, preview: boolean): MissMnemonic | undefined {
  if (rating !== 1 || preview) return undefined;
  const mnemonic = htmlToText(note.fields.Mnemonic ?? '').trim();
  if (!mnemonic) return undefined;
  return { word: headword(note), meaning: htmlToText(note.fields.Meaning ?? '').trim(), mnemonic };
}
