// The grammar row on the topics screen, and each point's line on the Grammar screen, in words.
import { studyDayStart } from '../core/day';
import type { GrammarPoint, GrammarSeen, GrammarState } from './api';

const plural = (n: number) => (n === 1 ? 'point' : 'points');
const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function grammarSummary(points: GrammarPoint[]): string {
  if (points.length === 0) return 'None for this language yet';
  const practicing = points.filter((p) => p.state === 'practice').length;
  const unknown = points.filter((p) => p.state === 'avoid').length;
  const parts = [
    practicing > 0 ? `Practicing ${practicing} ${plural(practicing)}` : null,
    unknown > 0 ? `${unknown} not known yet` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'Nothing chosen';
}

/** "today", "yesterday", "9 days ago", by study days. */
function daysAgo(at: Date, now: Date, dayStartsAtHour: number): string {
  const days = Math.round((studyDayStart(now, dayStartsAtHour).getTime() - studyDayStart(at, dayStartsAtHour).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * How often a point came up in the texts read to the end, for under its name: "In 9 texts you
 * read (23 times), last today". `brief` leaves out the count of uses (the "Seen least" card).
 * Null when the server sent no counts (one older than them).
 */
export function seenLine(
  seen: GrammarSeen | undefined,
  state: GrammarState,
  now: Date,
  dayStartsAtHour: number,
  brief = false,
): string | null {
  if (!seen) return null;
  const when = seen.last ? daysAgo(new Date(seen.last), now, dayStartsAtHour) : null;
  if (state === 'avoid') {
    return seen.texts === 0 || !when
      ? 'Kept out of texts'
      : `Kept out of texts. Slipped into ${times(seen.texts, 'text', 'texts')} you read, last ${when}`;
  }
  const line = seen.texts === 0 || !when
    ? "Not in any text you've read yet"
    : `In ${times(seen.texts, 'text', 'texts')} you read${brief ? '' : ` (${times(seen.uses, 'time', 'times')})`}, last ${when}`;
  return state === 'unset' ? `Not set. ${line}` : line;
}
