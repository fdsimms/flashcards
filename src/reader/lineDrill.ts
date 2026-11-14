// Using a text's lines yourself, after reading it (docs/read-and-listen/architecture.md, Client, Use
// the lines yourself): Say it back shows a line's English to say or type in the language, and Write
// what you hear plays a line to type. Each is compared with the line (core/typedCompare.ts) and
// marked Missed it or Got it by the reader; a missed line comes back at the end of the round. Built
// from the text's own lines, English and audio, so it costs nothing, and nothing is logged or
// graded. Pure, so it's tested; ReaderLineDrill.tsx shows it.
import type { ReaderText, TextLine } from './api';
import { choiceText } from './choices';

export type LineDrillKind = 'say' | 'hear';

/** A line asked has at least this many words, so it isn't a lone "Yes." */
export const MIN_WORDS = 2;
/** How many times a missed line comes back in one round. */
export const MAX_RETURNS = 2;

const wordy = (text: string) => /[\p{L}\p{N}]/u.test(text);

/** A line's text as written, its words joined as the reader shows them. */
export function lineText(line: TextLine): string {
  return choiceText(line);
}

/** The lines a round asks, in the text's order: ones with their English and enough words, and for Write what you hear, a recording. */
export function drillLines(text: ReaderText, kind: LineDrillKind): number[] {
  return text.lines.flatMap((line, i) => (
    line.english.trim() && line.words.filter((w) => wordy(w.text)).length >= MIN_WORDS && (kind === 'say' || line.audio) ? [i] : []
  ));
}

export interface LineRound {
  /** Lines to ask, in order; a missed one is added again at the end. */
  queue: number[];
  /** How far through `queue`. */
  at: number;
  /** Each line's first answer: right or not. */
  first: Record<number, boolean>;
}

export function startRound(lines: number[]): LineRound {
  return { queue: [...lines], at: 0, first: {} };
}

/** The line being asked, or undefined once the round is over. */
export function roundLine(r: LineRound): number | undefined {
  return r.queue[r.at];
}

/** Marks the line being asked Missed it or Got it and moves on: a missed line comes back at the end, up to MAX_RETURNS times. */
export function markLine(r: LineRound, right: boolean): LineRound {
  const line = roundLine(r);
  if (line === undefined) return r;
  const first = line in r.first ? r.first : { ...r.first, [line]: right };
  const asked = r.queue.filter((l) => l === line).length;
  const queue = !right && asked <= MAX_RETURNS ? [...r.queue, line] : r.queue;
  return { queue, at: r.at + 1, first };
}

/** Moves past the line being asked without marking it: it isn't counted, and doesn't come back. */
export function skipLine(r: LineRound): LineRound {
  return roundLine(r) === undefined ? r : { ...r, at: r.at + 1 };
}

/** How many lines were right the first time, of how many were asked. */
export function roundScore(r: LineRound): { right: number; asked: number } {
  const answers = Object.values(r.first);
  return { right: answers.filter(Boolean).length, asked: answers.length };
}

/** Where the round is, for the header: "3 of 8", counting distinct lines, so a line coming back doesn't add to the total. */
export function roundProgress(r: LineRound): { done: number; total: number } {
  const total = new Set(r.queue).size;
  return { done: Math.min(total, Object.keys(r.first).length + (roundLine(r) !== undefined && !(roundLine(r)! in r.first) ? 1 : 0)), total };
}
