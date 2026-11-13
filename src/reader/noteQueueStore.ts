import type { NoteQueue } from './api';

/** The queue as the server last said it, and the last problem reaching it (null when the last ask worked). */
export type NoteQueueState = { queue: NoteQueue | null; error: string | null };

/**
 * One copy of the queue for the deck list's card and the queue screens, so they agree and the server is
 * asked once for all of them (src/ui/useNoteQueue.ts does the asking).
 */
export function createNoteQueueStore() {
  let value: NoteQueueState = { queue: null, error: null };
  const listeners = new Set<() => void>();
  const set = (next: NoteQueueState) => {
    value = next;
    listeners.forEach((l) => l());
  };
  return {
    get: (): NoteQueueState => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set,
    clear: () => set({ queue: null, error: null }),
  };
}

export const noteQueueStore = createNoteQueueStore();
