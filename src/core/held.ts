import { OfflineError } from './connection';

/**
 * Work held on the phone while the servers can't be reached, and sent when they can
 * (src/ui/HeldWork.tsx): words for Claude to fill in (src/reader/heldNotes.ts) and recordings of
 * new notes. Pure, so it's tested; the lists are kept in the documents folder (src/ui/held.ts).
 */

/** A new note to record when the connection comes back, in the voice chosen when it was saved. */
export interface HeldRecording {
  noteId: string;
  voice: string;
}

/** The list with `r` on it, once per note (a note saved again keeps its place, in the newer voice). */
export function holdRecording(list: readonly HeldRecording[], r: HeldRecording): HeldRecording[] {
  return [...list.filter((x) => x.noteId !== r.noteId), r];
}

export function parseRecordings(raw: unknown): HeldRecording[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is HeldRecording => typeof x?.noteId === 'string' && typeof x?.voice === 'string')
    : [];
}

/** Whether an error is the connection's, so the item waits, rather than the server refusing it. */
export const isOffline = (e: unknown): boolean => e instanceof OfflineError || (e instanceof Error && (e as { status?: unknown }).status === 0);

/**
 * Sends each item in order. The first one lost to the connection stops it, and it and the rest
 * are left to try again; one the server refuses is set aside with its reason, and the rest go on.
 */
export async function sendHeld<T>(
  items: readonly T[],
  send: (item: T) => Promise<void>,
): Promise<{ left: T[]; refused: { item: T; error: unknown }[] }> {
  const refused: { item: T; error: unknown }[] = [];
  for (const [i, item] of items.entries()) {
    try {
      await send(item);
    } catch (e) {
      if (isOffline(e)) return { left: items.slice(i), refused };
      refused.push({ item, error: e });
    }
  }
  return { left: [], refused };
}

/**
 * A held list after `tried` was sent and `left` of it wasn't: what was sent or refused comes off,
 * and everything else stays where it is, items held while it ran included. The order is the
 * list's own, never `left` moved to the end: a story choice has to go before the reading held after it.
 */
export function afterSend<T>(list: readonly T[], tried: readonly T[], left: readonly T[]): T[] {
  return list.filter((x) => !tried.includes(x) || left.includes(x));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the Offline sheet lists as waiting for the connection, one line each, leaving out what has none. */
export function waitingLines(w: { answers: number; wanikani: number; words: number; recordings: number; readings: number; entries: number }): string[] {
  return [
    w.answers ? `${count(w.answers, 'answer', 'answers')} to sync` : '',
    w.wanikani ? `${count(w.wanikani, 'WaniKani answer', 'WaniKani answers')} to send` : '',
    w.words ? `${count(w.words, 'word', 'words')} to send to Claude` : '',
    w.recordings ? `${count(w.recordings, 'new note', 'new notes')} to record` : '',
    w.readings ? `${count(w.readings, 'reading', 'readings')} to send to Read & Listen` : '',
    w.entries ? `${count(w.entries, 'journal entry', 'journal entries')} to check` : '',
  ].filter(Boolean);
}
