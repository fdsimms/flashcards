import type { NoteQueue } from './api';

/** A word taken off the queue because the deck already had it, and the deck that has it, as a screen names it. */
export type DroppedWord = { entry: string; deck: string };

/**
 * The queue as the server last said it, the last problem reaching it (null when the last ask worked), and
 * the words taken off it because the deck already had them, kept until the queue screen has shown them.
 */
export type NoteQueueState = { queue: NoteQueue | null; error: string | null; dropped: DroppedWord[] };

/**
 * One copy of the queue for the deck list's card and the queue screens, so they agree and the server is
 * asked once for all of them (src/ui/useNoteQueue.ts does the asking).
 */
export function createNoteQueueStore() {
  const empty: NoteQueueState = { queue: null, error: null, dropped: [] };
  let value = empty;
  const listeners = new Set<() => void>();
  // What isn't given is kept: an answer from the server leaves `dropped` as it was.
  const set = (next: Partial<NoteQueueState>) => {
    value = { ...value, ...next };
    listeners.forEach((l) => l());
  };
  return {
    get: (): NoteQueueState => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set,
    clear: () => set(empty),
  };
}

export const noteQueueStore = createNoteQueueStore();
