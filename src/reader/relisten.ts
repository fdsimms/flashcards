// Texts to hear again (docs/read-and-listen/architecture.md, Client, Listen again): the shelf's card
// that offers the finished texts the server says are due (server relisten.py: 1, 4 and 10 study
// days after each was read), and what it says about them. Pure, so it's tested.
import { studyDayStart } from '../core/day';
import type { PastText } from './api';

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

/** "A", "A and B", "A, B and C". */
function listed(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export type ListenAgainCard = { title: string; detail: string; play: string };

/** What the card says, or null when nothing is due. */
export function listenAgainCard(texts: PastText[], now: Date, dayStartsAtHour: number): ListenAgainCard | null {
  if (texts.length === 0) return null;
  const names = texts.map((t) => {
    const ago = readAgo(t.read_at, now, dayStartsAtHour);
    return ago ? `"${t.title}" (${ago})` : `"${t.title}"`;
  });
  return {
    title: texts.length === 1 ? '1 text to hear again' : `${texts.length} texts to hear again`,
    detail: `${listed(names)}. Played with the words hidden.`,
    play: texts.length === 1 ? 'Play it' : texts.length === 2 ? 'Play both' : `Play all ${texts.length}`,
  };
}
