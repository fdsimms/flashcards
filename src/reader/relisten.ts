// Texts to hear again (docs/read-and-listen/architecture.md, Client, Listen again): the shelf's Hear again row
// that offers the finished texts the server says are due (server relisten.py: 1, 4 and 10 study
// days after each was read), and what it says about them. Pure, so it's tested.
import { studyDayStart } from '../core/day';

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "yesterday" or "4 days ago", counted in study days (the day starts at `dayStartsAtHour`). */
export function readAgo(readAt: string, now: Date, dayStartsAtHour: number): string {
  const read = new Date(readAt);
  if (Number.isNaN(read.getTime())) return '';
  // Rounded: a study day is 23 or 25 hours long where the clocks change.
  const days = Math.round((studyDayStart(now, dayStartsAtHour).getTime() - studyDayStart(read, dayStartsAtHour).getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The Hear again row's Play button, for `n` texts due: "Play it", "Play both", "Play all 3". */
export function listenAgainPlay(n: number): string {
  return n === 1 ? 'Play it' : n === 2 ? 'Play both' : `Play all ${n}`;
}
