// Which words in a text aren't in the deck: ones the deck doesn't hold at all, and ones it holds
// only inside a longer card (รับ inside รับอะไรดี). Coverage counts both as unknown, so the reader's
// highlight marks exactly the words the text was scored against.
import type { ReaderText, Word } from './api';

export function isOutsideDeck(word: Word): boolean {
  return word.status === 'unknown' || word.status === 'partial';
}

// A name the model marked (Mali, Kasia): not a word to know, so it's never outside the deck and the
// reader shades it with its own color.
export function isName(word: Word): boolean {
  return word.status === 'name';
}

export function countOutsideDeck(text: ReaderText): number {
  return text.lines.reduce((n, line) => n + line.words.filter(isOutsideDeck).length, 0);
}

// The lowest coverage target (`FLOOR` in server/reader/src/franki_reader/coverage.py). A text under
// it is the closest of the server's attempts, kept because it's still at 85% or more
// (docs/read-and-listen/architecture.md, Generation and coverage), so the reader says so.
export const FLOOR = 0.9;

export function underFloor(text: ReaderText): boolean {
  return text.coverage < FLOOR;
}
