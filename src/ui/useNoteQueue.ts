import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { ApiError, type Api, type Language, type NoteQueue } from '../reader/api';
import { noteQueueStore } from '../reader/noteQueueStore';

const POLL_MS = 4000;

// One poller for every screen showing the queue (the deck list's card and the queue screens), so the
// server is asked once however many are open. It looks when the first one opens and again when the app
// comes back to the front, and keeps looking only while some word is still waiting to be filled in.
const poll = { api: null as Api | null, users: 0, token: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined };

const reason = (e: unknown) => (e instanceof ApiError ? e.message : "Couldn't reach the server. Check your connection and try again.");
const anyWaiting = (queue: NoteQueue | null) => !!queue?.items.some((n) => n.state === 'waiting');

function schedule() {
  clearTimeout(poll.timer);
  poll.timer = setTimeout(look, POLL_MS);
}

async function look() {
  const { api, token } = poll;
  if (!api) return;
  try {
    const queue = await api.noteQueue();
    // Another sign-in, or everyone left, while the answer was on its way.
    if (token !== poll.token) return;
    noteQueueStore.set({ queue, error: null });
  } catch (e) {
    if (token !== poll.token) return;
    noteQueueStore.set({ queue: noteQueueStore.get().queue, error: reason(e) });
  }
  if (anyWaiting(noteQueueStore.get().queue)) schedule();
}

function acquire(api: Api) {
  poll.users++;
  if (poll.api !== api) {
    poll.api = api;
    poll.token++;
    noteQueueStore.clear();
  }
  look();
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') look(); });
  return () => {
    sub.remove();
    if (--poll.users === 0) { clearTimeout(poll.timer); poll.token++; poll.api = null; }
  };
}

/**
 * The note queue (src/reader/noteQueue.ts) as the server last said it, with what changes it. `api` is
 * null while Read & Listen is off, and the queue is then empty. The changes update the shared copy
 * from the server's answer, so every screen agrees at once.
 */
export function useNoteQueue(api: Api | null) {
  const { queue, error } = useSyncExternalStore(noteQueueStore.subscribe, noteQueueStore.get);
  useEffect(() => (api ? acquire(api) : undefined), [api]);

  const refresh = useCallback(() => { look(); }, []);
  const add = useCallback(async (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => {
    if (!api) return;
    noteQueueStore.set({ queue: await api.queueNotes(language, deck, entries), error: null });
    schedule();
  }, [api]);
  const retry = useCallback(async (id: number) => {
    if (!api) return;
    noteQueueStore.set({ queue: await api.retryQueuedNote(id), error: null });
    schedule();
  }, [api]);
  const remove = useCallback(async (id: number) => {
    if (!api) return;
    await api.removeQueuedNote(id);
    // Taken off here at once; the server's own list follows with the next look.
    const current = noteQueueStore.get().queue;
    if (current) noteQueueStore.set({ queue: { ...current, items: current.items.filter((n) => n.id !== id) }, error: null });
  }, [api]);

  return { queue: api ? queue : null, error: api ? error : null, refresh, add, retry, remove };
}
