import type { Language } from './api';
import { firstLine, nextLine, previousLine } from './playback';

/**
 * Play all carrying on after the reader is left: the mini-player on the tab bar takes over what
 * the reader was playing, one line after another, and at the end of the text goes on with Up Next
 * (audioQueue.ts), or stops (or goes round again, if Loop text was on). It is only
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
  /**
   * How Up Next logs it once played to its end (audioQueue.ts, `QueuedText.from`): a shelf text as
   * read by listening, a past text as heard again, or nothing (the reader logged it already, or it
   * ends on a choice). Left out, it isn't logged.
   */
  from?: 'shelf' | 'past' | null;
};

export type Step = { kind: 'again' } | { kind: 'line'; line: number } | { kind: 'end' };

/** What to do when the line has played to its end: repeat it, play the next (the first again, when looping), or stop. */
export function afterLine(h: Handoff): Step {
  if (h.played < h.repeat) return { kind: 'again' };
  const next = nextLine(h.lines, h.current, true, h.repeat, h.played, h.loop);
  return next === null ? { kind: 'end' } : { kind: 'line', line: next };
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
