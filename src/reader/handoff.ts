import type { Language } from './api';
import { firstLine, nextLine, previousLine, wrapsToStart } from './playback';

/**
 * Play all carrying on after the reader is left: the mini-player on the tab bar takes over what
 * the reader was playing, one line after another, and stops at the end of the text (or goes round again, if Loop text was on). It is only
 * the playing; the reader's own session (the reading log, the listen-first gate, moving on to the
 * next shelf text) ended when it closed.
 */
export type Handoff = {
  textId: number;
  title: string;
  language: Language;
  lines: { audio: boolean }[];
  /** The line sounding when the reader closed. */
  current: number;
  /** Plays per line (the repeat chip), and how many the current line has had in this round. */
  repeat: number;
  played: number;
  /** Loop text was on: after the last line it starts again from the first. */
  loop: boolean;
  /** The speed it was playing at. */
  rate: number;
};

export type Step = { kind: 'again' } | { kind: 'line'; line: number } | { kind: 'wrap'; line: number } | { kind: 'end' };

/** What to do when the line has played to its end: repeat it, play the next, go round to the first after a break (when looping), or stop. */
export function afterLine(h: Handoff): Step {
  if (h.played < h.repeat) return { kind: 'again' };
  const next = nextLine(h.lines, h.current, true, h.repeat, h.played, h.loop);
  if (next === null) return { kind: 'end' };
  return wrapsToStart(h.lines, h.current, true, h.repeat, h.played, h.loop) ? { kind: 'wrap', line: next } : { kind: 'line', line: next };
}

/** The line a skip button goes to, or null when there's none that way. */
export function skipTo(h: Pick<Handoff, 'lines' | 'current'>, step: -1 | 1): number | null {
  return step < 0 ? previousLine(h.lines, h.current) : firstLine(h.lines, h.current + 1);
}

/** The line to show as "Line n of m": counted among the lines that have audio. */
export function linePosition(h: Pick<Handoff, 'lines' | 'current'>): { n: number; of: number } {
  const voiced = h.lines.map((l, i) => (l.audio ? i : -1)).filter((i) => i >= 0);
  return { n: Math.max(1, voiced.indexOf(h.current) + 1), of: voiced.length };
}
