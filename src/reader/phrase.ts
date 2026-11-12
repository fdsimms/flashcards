import type { Word } from './api';

// Selecting a phrase in the reader, to have Claude explain it: tap a word, choose "Select a
// phrase" in its gloss, then tap the last word. A phrase stays within one line, so it has the
// line's context and the server can check it's really there. Indexes are into the line's
// `words`, the pieces the server split it into (spaces and punctuation included).

/** A phrase being selected (`end` null until the last word is tapped), or one selected. */
export type PhrasePick = { line: number; start: number; end: number | null };

/** Where a word object is: its line and its index there. Null when it isn't in the text. */
export function locate(lines: { words: Word[] }[], word: Word): { line: number; index: number } | null {
  for (let line = 0; line < lines.length; line++) {
    const index = lines[line].words.indexOf(word);
    if (index >= 0) return { line, index };
  }
  return null;
}

/**
 * The pick after a word is tapped while choosing the last word: the phrase from the first tap to
 * this one, either way round. A tap on the first word again, or on a word in another line,
 * leaves the pick as it was (the banner says a phrase stays in one line, with Cancel beside it).
 */
export function pickEnd(pick: PhrasePick, line: number, index: number): PhrasePick {
  if (pick.end !== null || line !== pick.line || index === pick.start) return pick;
  return { ...pick, end: index };
}

/** The first and last index of a selected phrase, in order. */
export function phraseRange(pick: PhrasePick): { from: number; to: number } | null {
  if (pick.end === null) return null;
  return { from: Math.min(pick.start, pick.end), to: Math.max(pick.start, pick.end) };
}

/** Where a word sits in the selected phrase, for drawing it: null when it's outside. */
export function phrasePart(pick: PhrasePick | null, line: number, index: number): 'only' | 'first' | 'middle' | 'last' | null {
  const range = pick && pick.line === line ? phraseRange(pick) : null;
  if (!range || index < range.from || index > range.to) return null;
  if (range.from === range.to) return 'only';
  return index === range.from ? 'first' : index === range.to ? 'last' : 'middle';
}

/** The selected phrase as it appears in the line: its words and everything between them. */
export function phraseText(words: Word[], pick: PhrasePick): string {
  const range = phraseRange(pick);
  if (!range) return '';
  return words.slice(range.from, range.to + 1).map((w) => w.text).join('').trim();
}
