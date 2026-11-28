import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { ApiError, type Api, type GlossLanguage, type NoteQueue, type QueueEntry } from '../reader/api';
import { OfflineError } from '../core/connection';
import { isOffline } from '../core/held';
import { notesStillThere } from '../core/noteEditing';
import { reviewWrites } from '../core/writeQueue';
import type { Repo } from '../db/repo';
import { holdWords } from '../reader/heldNotes';
import { loadParticle } from '../reader/lessonStorage';
import { noteQueueStore, type DroppedWord } from '../reader/noteQueueStore';
import { alreadyInDeck, isWorking, reviewTarget } from '../reader/noteQueue';
import { useApp } from './AppContext';
import { connection } from './connection';
import { deckShortName } from './deckShortName';
import { heldWords } from './held';

const POLL_MS = 4000;

// One poller for every screen showing the queue (the deck list's card and the queue screens), so the
// server is asked once however many are open. It looks when the first one opens and again when the app
// comes back to the front, and keeps looking only while some word is still waiting to be filled in.
const poll = { api: null as Api | null, repo: null as Repo | null, users: 0, token: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined };

// The ready words already checked against the deck, so each is checked once, as it turns ready, before
// the owner can open it (a word they've just saved would otherwise read as a duplicate of itself).
const checked = new Set<number>();

const reason = (e: unknown) => (e instanceof ApiError ? e.message : new OfflineError().message);
const anyWaiting = (queue: NoteQueue | null) => !!queue?.items.some(isWorking);

// A change made here (a word added, retried or removed) makes a look already on its way out of date:
// its answer was read before the change, and would put back what the change took away.
function supersede() {
  poll.token++;
}

/**
 * Sends words to the queue and shows the server's answer: for `add`, and for words held offline
 * (HeldWork.tsx), so both make a look on its way out of date.
 */
export async function queueWords(api: Api, language: GlossLanguage, deck: string, entries: QueueEntry[]): Promise<void> {
  const queue = await api.queueNotes(language, deck, entries, language === 'th' ? await loadParticle() : undefined);
  supersede();
  noteQueueStore.set({ queue, error: null });
  schedule();
}

function schedule() {
  clearTimeout(poll.timer);
  poll.timer = setTimeout(look, POLL_MS);
}

/**
 * Takes the ready words the deck already has off the queue (`alreadyInDeck`, the check the save would
 * refuse them by) and returns the queue without them, recording each for the queue screen to say so.
 * Words typed the way they sound, and words tapped in Practice or a cram that the deck has as a new,
 * unstudied card, both reach the queue this way. A word that can't be read against the deck or taken
 * off stays, and Approve all refuses it with the reason, as before.
 */
async function dropDuplicates(api: Api, repo: Repo, queue: NoteQueue): Promise<NoteQueue> {
  const fresh = queue.items.filter((n) => n.state === 'ready' && !checked.has(n.id));
  if (!fresh.length) return queue;
  let found: ReturnType<typeof alreadyInDeck>;
  try {
    await reviewWrites.idle();
    const [all, cards, types] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listNoteTypes()]);
    found = alreadyInDeck(fresh, notesStillThere(all, cards), types);
  } catch {
    return queue;
  }
  fresh.forEach((n) => checked.add(n.id));
  const gone = new Set<number>();
  const dropped: DroppedWord[] = [];
  for (const { note, deck } of found) {
    try {
      await api.removeQueuedNote(note.id);
      gone.add(note.id);
      dropped.push({ entry: reviewTarget(note).fields.Entry || note.entry, deck: deckShortName(deck) });
    } catch {
      // Left on the queue: Approve all and the note editor still say why it can't be saved.
    }
  }
  if (!gone.size) return queue;
  noteQueueStore.set({ dropped: [...noteQueueStore.get().dropped, ...dropped] });
  return { ...queue, items: queue.items.filter((n) => !gone.has(n.id)) };
}

async function look() {
  const { api, repo, token } = poll;
  if (!api) return;
  try {
    const answer = await api.noteQueue();
    // Another sign-in, or everyone left, while the answer was on its way.
    if (token !== poll.token) return;
    const queue = repo ? await dropDuplicates(api, repo, answer) : answer;
    if (token !== poll.token) return;
    noteQueueStore.set({ queue, error: null });
  } catch (e) {
    if (token !== poll.token) return;
    noteQueueStore.set({ queue: noteQueueStore.get().queue, error: reason(e) });
  }
  if (anyWaiting(noteQueueStore.get().queue)) schedule();
}

function acquire(api: Api, repo: Repo) {
  poll.users++;
  poll.repo = repo;
  if (poll.api !== api) {
    poll.api = api;
    poll.token++;
    checked.clear();
    noteQueueStore.clear();
  }
  look();
  const sub = AppState.addEventListener('change', (s) => { if (s === 'active') look(); });
  return () => {
    sub.remove();
    if (--poll.users === 0) { clearTimeout(poll.timer); poll.token++; poll.api = null; poll.repo = null; }
  };
}

/**
 * The note queue (src/reader/noteQueue.ts) as the server last said it, with what changes it. `api` is
 * null while Read & Listen is off, and the queue is then empty. The changes update the shared copy
 * from the server's answer, so every screen agrees at once.
 */
export function useNoteQueue(api: Api | null) {
  const { repo } = useApp();
  const { queue, error, dropped } = useSyncExternalStore(noteQueueStore.subscribe, noteQueueStore.get);
  useEffect(() => (api ? acquire(api, repo) : undefined), [api, repo]);

  const refresh = useCallback(() => { look(); }, []);
  /**
   * Queues words for Claude. Offline they're held on the phone instead ('held') and sent when the
   * connection comes back (HeldWork.tsx); a refusal from the server is thrown as before.
   */
  const add = useCallback(async (language: GlossLanguage, deck: string, entries: QueueEntry[]): Promise<'queued' | 'held' | undefined> => {
    if (!api) return undefined;
    const hold = async () => {
      await heldWords.update((list) => holdWords(list, language, deck, entries));
      return 'held' as const;
    };
    if (connection.cantReachHome()) return hold();
    try {
      await queueWords(api, language, deck, entries);
    } catch (e) {
      if (isOffline(e)) return hold();
      throw e;
    }
    return 'queued';
  }, [api]);
  const retry = useCallback(async (id: number) => {
    if (!api) return;
    const queue = await api.retryQueuedNote(id);
    supersede();
    noteQueueStore.set({ queue, error: null });
    schedule();
  }, [api]);
  const remove = useCallback(async (id: number) => {
    if (!api) return;
    await api.removeQueuedNote(id);
    supersede();
    // Taken off here at once; the server's own list follows with the next look.
    const current = noteQueueStore.get().queue;
    if (current) noteQueueStore.set({ queue: { ...current, items: current.items.filter((n) => n.id !== id) }, error: null });
    if (anyWaiting(noteQueueStore.get().queue)) schedule();
  }, [api]);

  /** Forgets the words taken off as duplicates, once the queue screen has said so. */
  const clearDropped = useCallback(() => { noteQueueStore.set({ dropped: [] }); }, []);

  return { queue: api ? queue : null, error: api ? error : null, dropped: api ? dropped : [], clearDropped, refresh, add, retry, remove };
}
