// The text of a word's form sheet (ui/ReadFormSheet.tsx): the pieces of a primer's marked text, and the
// line that ties the primer back to the word that was tapped. Pure, so it's tested.

import type { Word } from './api';

/** A run of a primer's text: `marked` runs are the part to highlight, an ending. */
export type Piece = { text: string; marked: boolean };

/** Splits text at its `*asterisks*`: "ручк*ой*" is "ручк" then the marked "ой". */
export function pieces(text: string): Piece[] {
  return text
    .split('*')
    .map((t, i) => ({ text: t, marked: i % 2 === 1 }))
    .filter((p) => p.text !== '');
}

/** What the sheet says about the tapped word: its form, and what it means in its line. */
export function aboutWord(word: Pick<Word, 'text' | 'lemma' | 'gloss'>, formName: string): string {
  const is = word.lemma ? `${word.text} is the ${formName} of ${word.lemma}.` : `${word.text} is the ${formName}.`;
  return word.gloss ? `${is} Here it means "${word.gloss}".` : is;
}
