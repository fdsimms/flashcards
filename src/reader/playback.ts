// Which line plays next. 'Play' runs the dialogue from a line to the end, skipping lines with no
// audio; a line's own replay button plays that line alone. With 'Repeat line' on, the line that
// just finished plays again, until it's turned off. A paragraph's play button runs its lines and
// stops at the paragraph's last one (`end`).
type HasAudio = { audio: boolean };

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
  repeat = false,
  end: number | null = null,
): number | null {
  if (repeat) return finished;
  if (!playingAll) return null;
  const next = firstLine(lines, finished + 1);
  return next !== null && (end === null || next <= end) ? next : null;
}
