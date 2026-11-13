// Which line plays next. 'Play' runs the dialogue from a line to the end, skipping lines with no
// audio; a line's own replay button plays that line alone. 'Repeat line' plays the line that just
// finished again until it has played the chosen number of times (or until it's turned off, for ∞).
type HasAudio = { audio: boolean };

/** Plays per line the repeat chip steps through: 1 is off, Infinity is until turned off. */
export const REPEAT_COUNTS = [1, 2, 3, 5, Infinity] as const;
export type RepeatCount = (typeof REPEAT_COUNTS)[number];

/** The count after `count` when the chip is tapped, wrapping from ∞ back to off. */
export function nextRepeatCount(count: number): RepeatCount {
  const at = REPEAT_COUNTS.findIndex((c) => c === count);
  return REPEAT_COUNTS[(at + 1) % REPEAT_COUNTS.length];
}

/** The chip's text: 'Repeat: Off', '3×' or '∞'. */
export function repeatChipLabel(count: number): string {
  return count <= 1 ? 'Repeat: Off' : count === Infinity ? '∞' : `${count}×`;
}

/** A run of lines, by index, both ends included. */
export type Range = { start: number; end: number };

/**
 * A story's paragraphs, each a run of lines starting at a line marked as opening one. null for a
 * text with no paragraph marks (a dialogue, or a story written before paragraphs): it's shown a
 * line at a time.
 */
export function paragraphs(lines: { paragraph?: boolean }[]): Range[] | null {
  if (!lines.some((l) => l.paragraph)) return null;
  const out: Range[] = [];
  lines.forEach((l, i) => {
    if (out.length === 0 || l.paragraph) out.push({ start: i, end: i });
    else out[out.length - 1].end = i;
  });
  return out;
}

/** The index of the range holding `line`, or -1. */
export function rangeOf(ranges: Range[], line: number): number {
  return ranges.findIndex((r) => line >= r.start && line <= r.end);
}

export function firstLine(lines: HasAudio[], from = 0): number | null {
  for (let i = Math.max(0, from); i < lines.length; i++) if (lines[i].audio) return i;
  return null;
}

export function nextLine(
  lines: HasAudio[],
  finished: number,
  playingAll: boolean,
  repeat: number = 1,
  /** How many times the line that just finished has played in this round, counting that play. */
  played: number = 1,
): number | null {
  if (played < repeat) return finished;
  return playingAll ? firstLine(lines, finished + 1) : null;
}

/** The nearest line before `from` that has audio (the previous-line button), else null. */
export function previousLine(lines: HasAudio[], from: number): number | null {
  for (let i = Math.min(from, lines.length) - 1; i >= 0; i--) if (lines[i].audio) return i;
  return null;
}
