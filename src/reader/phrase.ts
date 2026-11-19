import type { Word } from './api';

// Selecting a phrase in the reader, to have Claude explain it: hold a word and drag to the last
// one. A phrase can run on into the lines around the one it starts in, up to MAX_PHRASE_LINES of
// them, so a sentence the text split over two lines can be picked whole; the server checks it's
// really there and reads it with those lines as its context. Indexes are into each line's `words`,
// the pieces the server split it into (spaces and punctuation included).

/**
 * The most lines one phrase may span. The server refuses more (MAX_PHRASE_LINES in
 * server/reader/src/franki_reader/routes/explain.py): keep the two the same.
 */
export const MAX_PHRASE_LINES = 4;

/** A word's place in the text: its line and its index in that line's `words`. */
export type WordAt = { line: number; index: number };

/** A phrase being selected, or one selected: a drag starts on one word (`start`) and ends on another (`end`), either way round. */
export type PhrasePick = { start: WordAt; end: WordAt };

/** Where a word object is: its line and its index there. Null when it isn't in the text. */
export function locate(lines: { words: Word[] }[], word: Word): WordAt | null {
  for (let line = 0; line < lines.length; line++) {
    const index = lines[line].words.indexOf(word);
    if (index >= 0) return { line, index };
  }
  return null;
}

const before = (a: WordAt, b: WordAt) => a.line < b.line || (a.line === b.line && a.index < b.index);

/** The first and last word of a selected phrase, in reading order. */
export function phraseRange(pick: PhrasePick): { from: WordAt; to: WordAt } {
  return before(pick.end, pick.start) ? { from: pick.end, to: pick.start } : { from: pick.start, to: pick.end };
}

/** Where a word sits in the selected phrase, for drawing it: null when it's outside. */
export function phrasePart(pick: PhrasePick | null, line: number, index: number): 'only' | 'first' | 'middle' | 'last' | null {
  if (!pick) return null;
  const { from, to } = phraseRange(pick);
  const at = { line, index };
  if (before(at, from) || before(to, at)) return null;
  const isFrom = line === from.line && index === from.index;
  const isTo = line === to.line && index === to.index;
  if (isFrom && isTo) return 'only';
  return isFrom ? 'first' : isTo ? 'last' : 'middle';
}

/**
 * The selected phrase as it appears in the text: its words and everything between them. Where it
 * runs on into the next line the two are joined with a space, as the server joins them to check it.
 */
export function phraseText(lines: { words: Word[] }[], pick: PhrasePick): string {
  const { from, to } = phraseRange(pick);
  const parts: string[] = [];
  for (let line = from.line; line <= to.line; line++) {
    const words = lines[line]?.words ?? [];
    const first = line === from.line ? from.index : 0;
    const last = line === to.line ? to.index : words.length - 1;
    parts.push(words.slice(first, last + 1).map((w) => w.text).join('').trim());
  }
  return parts.filter(Boolean).join(' ');
}

/** The lines a drag starting in `line` may reach: MAX_PHRASE_LINES either way, counting its own. */
export function reachableLines(line: number, count: number): { first: number; last: number } {
  return { first: Math.max(0, line - (MAX_PHRASE_LINES - 1)), last: Math.min(count - 1, line + (MAX_PHRASE_LINES - 1)) };
}

/** Where a word of the text is on screen, measured when a drag starts. */
export type WordBox = WordAt & { x: number; y: number; width: number; height: number };

/**
 * The word a dragging finger is on: the one under it, else the nearest on its row of text, else
 * the nearest row's. Rows come first, so a finger between two words, or past the end of a row,
 * keeps to the row it's on. Only the words of the lines in reach are measured, so a phrase can't
 * leave them.
 */
export function wordUnder(boxes: WordBox[], x: number, y: number): WordAt | null {
  let best: { at: WordAt; dy: number; dx: number } | null = null;
  for (const b of boxes) {
    const dy = y < b.y ? b.y - y : y > b.y + b.height ? y - (b.y + b.height) : 0;
    const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - (b.x + b.width) : 0;
    if (!best || dy < best.dy || (dy === best.dy && dx < best.dx)) best = { at: { line: b.line, index: b.index }, dy, dx };
  }
  return best ? best.at : null;
}

/**
 * The pick as the finger reaches a word: the phrase runs from where the drag started to it, kept
 * within MAX_PHRASE_LINES lines of the start.
 */
export function dragTo(pick: PhrasePick, at: WordAt): PhrasePick {
  if (pick.end.line === at.line && pick.end.index === at.index) return pick;
  if (Math.abs(at.line - pick.start.line) >= MAX_PHRASE_LINES) return pick;
  return { ...pick, end: at };
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
