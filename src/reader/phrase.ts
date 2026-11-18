import type { Word } from './api';

// Selecting a phrase in the reader, to have Claude explain it: hold a word and drag to the last
// one. A phrase
// stays within one line, so it has the line's context and the server can check it's really there. Indexes are into the line's
// `words`, the pieces the server split it into (spaces and punctuation included).

/** A phrase being selected, or one selected: a drag starts on one word (`start`) and ends on another (`end`), either way round. */
export type PhrasePick = { line: number; start: number; end: number };

/** Where a word object is: its line and its index there. Null when it isn't in the text. */
export function locate(lines: { words: Word[] }[], word: Word): { line: number; index: number } | null {
  for (let line = 0; line < lines.length; line++) {
    const index = lines[line].words.indexOf(word);
    if (index >= 0) return { line, index };
  }
  return null;
}

/** The first and last index of a selected phrase, in order. */
export function phraseRange(pick: PhrasePick): { from: number; to: number } {
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
  return words.slice(range.from, range.to + 1).map((w) => w.text).join('').trim();
}

/** Where a word of the line is on screen, measured when a drag starts. */
export type WordBox = { index: number; x: number; y: number; width: number; height: number };

/**
 * The word a dragging finger is on: the one under it, else the nearest on its row of text, else
 * the nearest row's. Rows come first, so a finger between two words, or past the end of a row,
 * keeps to the row it's on. Only the line's own words are measured, so a phrase can't leave it.
 */
export function wordUnder(boxes: WordBox[], x: number, y: number): number | null {
  let best: { index: number; dy: number; dx: number } | null = null;
  for (const b of boxes) {
    const dy = y < b.y ? b.y - y : y > b.y + b.height ? y - (b.y + b.height) : 0;
    const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - (b.x + b.width) : 0;
    if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) best = { index: b.index, dy, dx };
  }
  return best ? best.index : null;
}

/** The pick as the finger reaches a word: the phrase runs from where the drag started to it. */
export function dragTo(pick: PhrasePick, index: number): PhrasePick {
  return pick.end === index ? pick : { ...pick, end: index };
}

/** Where the phrase popup sits and how tall it may be (window coordinates). */
export type PopupSpace = { side: 'below' | 'above' | 'top'; maxHeight: number };

/**
 * The popup beside the selected phrase: on the side `below` says (the one with more room, chosen
 * once so it doesn't jump when the answer arrives), at most `share` of the window and never past
 * the window's edge. While a question is being typed the popup goes to the top instead, and takes
 * what the keyboard leaves, so the phrase's heading and the answer aren't behind it.
 * `gap` is the space between the phrase and the popup, `edge` the space kept at the window's edge.
 */
export function popupSpace({ anchor, windowHeight, insetTop, insetBottom, keyboard, typing, below, gap, edge, share }: {
  anchor: { top: number; bottom: number };
  windowHeight: number;
  insetTop: number;
  insetBottom: number;
  keyboard: number;
  typing: boolean;
  below: boolean;
  gap: number;
  edge: number;
  share: number;
}): PopupSpace {
  if (typing) {
    return { side: 'top', maxHeight: Math.max(0, windowHeight - Math.max(keyboard, insetBottom) - insetTop - edge - gap) };
  }
  const room = below ? windowHeight - anchor.bottom - gap - insetBottom - edge : anchor.top - gap - insetTop - edge;
  return { side: below ? 'below' : 'above', maxHeight: Math.max(0, Math.min(windowHeight * share, room)) };
}

/** Whether the room below the phrase is at least the room above it, for `popupSpace`'s `below`. */
export function roomIsBelow(anchor: { top: number; bottom: number }, windowHeight: number, insetTop: number, insetBottom: number): boolean {
  return windowHeight - anchor.bottom - insetBottom >= anchor.top - insetTop;
}
