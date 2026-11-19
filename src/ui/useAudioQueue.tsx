import { File, Paths } from 'expo-file-system';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Api, ReaderText } from '../reader/api';
import {
  advance, back, backRestarts, clearNext, EMPTY_QUEUE, keepPlayingPick, keyOf, languageOf, listenLog, move as moveItem,
  parseQueue, playLater as queueLater, playNext as queueNext, playNow as queueNow, remove as removeItem, restoreNext,
  setResume, shelfItem, sleepDelay, type AudioQueue, type QueueItem, type RepeatMode, type SleepTimer,
} from '../reader/audioQueue';
import { holdsPlayAll } from '../reader/choices';
import { mayDownload } from '../reader/downloads';
import { atEnd } from '../reader/lessons';
import { firstLine } from '../reader/playback';
import { hasSlow, speedFor } from '../reader/prefs';
import { prefs, savePrefs } from '../reader/storage';
import { failureText } from '../core/failure';
import { useApp } from './AppContext';
import { connection } from './connection';
import { downloads } from './reader/readerDownloads';
import { useReaderPlayerHost, type Carried, type Position } from './useReaderPlayer';

/**
 * Up Next (src/reader/audioQueue.ts has the rules): Read & Listen texts and audio lessons played one
 * after another on the shared player, kept on the phone with where each stopped, so the queue and its
 * places survive the app being closed. The tab bar's mini-player, Now Playing and Up Next read it
 * from here. The player (useReaderPlayer.tsx) tells it, through `attachQueue`, when a screen hands
 * something over, when an item plays to its end (it goes on to the next, or repeats, or keeps playing
 * the shelf), and where playing stopped short. A text played to its end is logged as listened to
 * (`listenLog`); nothing here rates a card.
 */

const FILE = 'audio-queue.json';
/** How often a lesson's place is kept while it plays, in ms; a text's is kept at each line. */
const KEEP_EVERY_MS = 15_000;

let stored: AudioQueue = EMPTY_QUEUE;
let loading: Promise<AudioQueue> | null = null;

function loadQueue(): Promise<AudioQueue> {
  loading ??= (async () => {
    try {
      const f = new File(Paths.document, FILE);
      stored = parseQueue(f.exists ? JSON.parse(await f.text()) : null);
    } catch {
      // An unreadable file is an empty queue.
    }
    return stored;
  })();
  return loading;
}

function saveQueue(q: AudioQueue) {
  stored = q;
  try {
    const f = new File(Paths.document, FILE);
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(q));
  } catch {
    // Still played from memory; only its places are lost if the app is closed.
  }
}

export interface AudioQueueHost {
  queue: AudioQueue;
  /** Whether the one playing is on the player now (else it waits, paused, for Play). */
  live: boolean;
  playing: boolean;
  /** "Line 6 of 18" while a text plays; null otherwise. */
  line: { n: number; of: number } | null;
  /** The speed the text playing is at, and whether its language offers Slow; null for a lesson. */
  speed: { rate: number; slowOffered: boolean } | null;
  /** Why the last item couldn't start, written for a person; null when it did. */
  problem: string | null;
  playNow: (item: QueueItem) => void;
  playNext: (item: QueueItem) => void;
  playLater: (item: QueueItem) => void;
  remove: (key: string) => void;
  move: (from: number, to: number) => void;
  /** Empties Up Next; returns Undo. */
  clear: () => () => void;
  toggle: () => void;
  /** The next or previous item (previous starts the one playing again past its start). */
  next: () => void;
  previous: () => void;
  /** Stops the one playing and takes it out; the next waits, paused. */
  stopNow: () => void;
  setRepeat: (mode: RepeatMode) => void;
  setKeepPlaying: (on: boolean) => void;
  sleep: SleepTimer | null;
  setSleep: (timer: SleepTimer | null) => void;
  setRate: (rate: number) => void;
}

function useAudioQueueHost(): AudioQueueHost {
  const host = useReaderPlayerHost();
  const api = useApp().reader.api;
  const apiRef = useRef<Api | null>(api);
  apiRef.current = api;
  const [queue, setQueue] = useState<AudioQueue>(stored);
  const queueRef = useRef(queue);
  const [problem, setProblem] = useState<string | null>(null);
  const [sleep, setSleepState] = useState<SleepTimer | null>(null);
  const sleepRef = useRef(sleep);
  sleepRef.current = sleep;
  // The text playing as the server gave it (for an episode's choice), and when the item began, for the log's seconds.
  const playingText = useRef<ReaderText | null>(null);
  const began = useRef<{ key: string; at: number; logged: boolean } | null>(null);
  // Counts starts: a text is fetched before it plays, and a newer start wins.
  const starting = useRef(0);

  const update = useCallback((change: (q: AudioQueue) => AudioQueue) => {
    const next = change(queueRef.current);
    if (next === queueRef.current) return;
    queueRef.current = next;
    setQueue(next);
    saveQueue(next);
  }, []);

  useEffect(() => {
    void loadQueue().then((q) => {
      // Anything changed before the file was read wins over it.
      if (queueRef.current !== EMPTY_QUEUE) return;
      queueRef.current = q;
      setQueue(q);
    });
  }, []);

  /** Whether the player is carrying `item` now. */
  const carryingNow = useCallback((item: QueueItem | null): boolean => {
    const at = host.position();
    if (!item || !at) return false;
    return item.kind === 'text' ? at.kind === 'text' && at.textId === item.textId : at.kind === 'lesson' && at.id === item.lesson.id;
  }, [host]);

  /** Plays `item` on the player, from where it stopped or from `from` (a line or seconds). */
  const start = useCallback(async (item: QueueItem, from?: number) => {
    const mine = ++starting.current;
    const server = apiRef.current;
    setProblem(null);
    if (!server) {
      setProblem("Up Next plays Read & Listen's texts and lessons, which needs its passphrase. Enter it in Settings, Read & Listen.");
      return;
    }
    const key = keyOf(item);
    if (began.current?.key !== key) began.current = { key, at: Date.now(), logged: false };
    if (item.kind === 'lesson') {
      playingText.current = null;
      const at = from ?? item.resume ?? 0;
      await host.playLesson(server, item.lesson, atEnd(at, item.lesson.duration_ms / 1000) ? 0 : at);
      return;
    }
    let text: ReaderText;
    try {
      text = await server.text(item.textId);
    } catch (e) {
      if (starting.current === mine) setProblem(failureText(e, { next: 'Check your connection and try again.' }));
      return;
    }
    if (starting.current !== mine) return;
    const first = firstLine(text.lines);
    if (first === null) {
      setProblem(`${text.title} has no recording yet. Open it in Read & Listen to read it instead.`);
      return;
    }
    playingText.current = text;
    host.playText(server, {
      textId: text.id, title: text.title, language: text.language, lines: text.lines,
      current: firstLine(text.lines, from ?? item.resume ?? first) ?? first,
      repeat: 1, played: 1, loop: false, rate: speedFor(prefs(), text.language), from: item.from,
    });
  }, [host]);

  /** Logs a text played through, once per time it's started: as read by listening, or heard again. */
  const logPlayed = useCallback((item: QueueItem, what: Carried) => {
    const server = apiRef.current;
    if (!server || item.kind !== 'text' || what.kind !== 'text' || began.current?.logged) return;
    const from = what.handoff.from === undefined ? item.from : what.handoff.from;
    const text = playingText.current?.id === item.textId ? playingText.current : null;
    const seconds = began.current?.key === keyOf(item) ? (Date.now() - began.current.at) / 1000 : 0;
    const log = listenLog({ ...item, from }, seconds, what.handoff.rate, text ? holdsPlayAll(text, from === 'past') : false);
    if (began.current) began.current.logged = true;
    // withOffline holds it to send later when the server can't be reached; anything else is let go, as the reader does.
    if (log?.kind === 'reading') server.logReading(item.textId, log.log).catch(() => undefined);
    else if (log?.kind === 'listen') server.logListen(item.textId).catch(() => undefined);
  }, []);

  /** Once Up Next runs out after a shelf text: that language's next shelf text, if Keep playing the shelf is on. */
  const keepPlaying = useCallback(async (finished: QueueItem) => {
    const server = apiRef.current;
    if (!server) return false;
    try {
      const shelf = await server.shelf(languageOf(finished));
      const pick = keepPlayingPick(queueRef.current, finished, shelf);
      if (!pick || queueRef.current.now) return false;
      const item = shelfItem(pick, shelf.language);
      update((q) => queueNow(q, item));
      await start(item);
      return true;
    } catch {
      return false;
    }
  }, [start, update]);

  // The player's side: what it hands over, plays through and stops.
  useEffect(() => {
    host.attachQueue({
      carried: (what) => {
        const item: QueueItem = what.kind === 'lesson'
          ? { kind: 'lesson', lesson: what.lesson }
          : { kind: 'text', textId: what.handoff.textId, title: what.handoff.title, language: what.handoff.language, from: what.handoff.from ?? null };
        const key = keyOf(item);
        // The queue's own copy keeps the text's form and length for its row.
        update((q) => {
          const known = [q.now, ...q.next].find((i) => i && keyOf(i) === key);
          const merged = known && known.kind === 'text' && item.kind === 'text' ? { ...known, from: item.from } : item;
          const moved = queueNow(q, merged);
          return what.kind === 'text' ? setResume(moved, key, what.handoff.current) : moved;
        });
        if (began.current?.key !== key) began.current = { key, at: Date.now(), logged: false };
        if (what.kind === 'lesson') playingText.current = null;
      },
      ended: (what) => {
        const q = queueRef.current;
        const now = q.now;
        if (!now) return false;
        logPlayed(now, what);
        // Repeat one plays it again; it was logged the first time through, and isn't again.
        if (q.repeat === 'one') {
          void start(now, 0);
          return true;
        }
        // Played again later (from Recently played), it's a new time through, logged again.
        began.current = null;
        const after = advance(q);
        update(() => after);
        if (sleepRef.current?.kind === 'item') {
          setSleepState(null);
          return false;
        }
        if (after.now) {
          void start(after.now);
          return true;
        }
        if (!q.keepPlaying || now.kind !== 'text' || now.from !== 'shelf') return false;
        // The player stays on (and the app awake in the background) while the shelf is asked.
        void keepPlaying(now).then((played) => { if (!played) host.stop(); });
        return true;
      },
      stopped: (at: Position) => {
        const q = queueRef.current;
        const now = q.now;
        if (!now) return;
        if (at.kind === 'text' && now.kind === 'text' && now.textId === at.textId) {
          update((x) => setResume(x, keyOf(now), at.line > at.first ? at.line : null));
        } else if (at.kind === 'lesson' && now.kind === 'lesson' && now.lesson.id === at.id) {
          const done = atEnd(at.seconds, now.lesson.duration_ms / 1000);
          update((x) => setResume(x, keyOf(now), at.seconds > 1 && !done ? at.seconds : null));
        }
      },
      track: (step) => { (step > 0 ? nextRef : previousRef).current(); },
    });
  }, [host.attachQueue, logPlayed, start, update, keepPlaying]); // eslint-disable-line react-hooks/exhaustive-deps -- host.stop is stable

  // Each line a text reaches is where it starts again; a lesson's place is kept every few seconds.
  const lineNow = host.mini?.kind === 'text' ? host.mini.line.n : null;
  useEffect(() => {
    const at = host.position();
    const now = queueRef.current.now;
    if (at?.kind === 'text' && now?.kind === 'text' && now.textId === at.textId) update((q) => setResume(q, keyOf(now), at.line > at.first ? at.line : null));
  }, [lineNow]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the line moves
  const lessonPlaying = host.mini?.kind === 'lesson' && host.mini.playing;
  useEffect(() => {
    if (!lessonPlaying) return;
    const timer = setInterval(() => {
      const at = host.position();
      const now = queueRef.current.now;
      if (at?.kind === 'lesson' && now?.kind === 'lesson' && now.lesson.id === at.id) update((q) => setResume(q, keyOf(now), at.seconds > 1 ? at.seconds : null));
    }, KEEP_EVERY_MS);
    return () => clearInterval(timer);
  }, [lessonPlaying, host, update]);

  // The sleep timer: pauses when it's due (End of item is the player's, in `ended`).
  useEffect(() => {
    const delay = sleepDelay(sleep, Date.now());
    if (delay === null) return;
    const timer = setTimeout(() => {
      host.pause();
      setSleepState(null);
    }, delay);
    return () => clearTimeout(timer);
  }, [sleep, host]);

  /** A lesson added to Up Next is downloaded, under the same setting as the shelf's texts, so the queue plays offline. */
  const keep = useCallback((item: QueueItem) => {
    const server = apiRef.current;
    if (!server || item.kind !== 'lesson') return;
    if (downloads.get().lessons.some((l) => l.lesson.id === item.lesson.id && l.complete)) return;
    if (!mayDownload(prefs().offlineDownloads, connection.get().path)) return;
    downloads.saveLesson(server, item.lesson).catch(() => undefined);
  }, []);

  const playNow = useCallback((item: QueueItem) => {
    const current = queueRef.current.now;
    if (current && keyOf(current) === keyOf(item) && carryingNow(current)) {
      if (!host.player.playing) host.toggle();
      return;
    }
    // Stopping first keeps the place of what was playing; it goes back to the top of Up Next.
    if (carryingNow(queueRef.current.now)) host.stop();
    update((q) => queueNow(q, item));
    keep(item);
    const now = queueRef.current.now;
    if (now) void start(now);
  }, [carryingNow, host, keep, start, update]);

  const playNext = useCallback((item: QueueItem) => { update((q) => queueNext(q, item)); keep(item); }, [keep, update]);
  const playLater = useCallback((item: QueueItem) => { update((q) => queueLater(q, item)); keep(item); }, [keep, update]);

  const stopNow = useCallback(() => {
    const now = queueRef.current.now;
    if (!now) return;
    if (carryingNow(now)) host.stop();
    update((q) => removeItem(q, keyOf(now)));
    setProblem(null);
  }, [carryingNow, host, update]);

  const remove = useCallback((key: string) => {
    const now = queueRef.current.now;
    if (now && keyOf(now) === key) stopNow();
    else update((q) => removeItem(q, key));
  }, [stopNow, update]);

  const move = useCallback((from: number, to: number) => update((q) => moveItem(q, from, to)), [update]);

  const clear = useCallback(() => {
    const { queue: cleared, removed } = clearNext(queueRef.current);
    update(() => cleared);
    return () => update((q) => restoreNext(q, removed));
  }, [update]);

  const toggle = useCallback(() => {
    const now = queueRef.current.now;
    if (!now) return;
    if (carryingNow(now)) host.toggle();
    else void start(now);
  }, [carryingNow, host, start]);

  const next = useCallback(() => {
    const q = queueRef.current;
    if (!q.now) return;
    const live = carryingNow(q.now);
    const wasPlaying = live && (host.player.playing || host.waits.held);
    if (live) host.stop();
    // Skipped, not finished: it's in Recently played, but not logged as listened to.
    update(advance);
    const now = queueRef.current.now;
    // Skipping while paused leaves the next one waiting, paused, as a podcast app does.
    if (now && wasPlaying) void start(now);
  }, [carryingNow, host, start, update]);

  const previous = useCallback(() => {
    const q = queueRef.current;
    if (!q.now) return;
    const live = carryingNow(q.now);
    const at = live ? host.position() : null;
    const restarts = at ? backRestarts(at.kind === 'text' ? { kind: 'text', line: at.line, first: at.first } : { kind: 'lesson', seconds: at.seconds }) : false;
    // Stopped first, so the one playing keeps its place as it goes back to Up Next.
    if (live) host.stop();
    const went = restarts ? null : back(queueRef.current);
    if (!went) {
      // Nothing played before, or past the start: the one playing again from its start.
      update((x) => setResume(x, keyOf(q.now!), null));
      void start(queueRef.current.now!, 0);
      return;
    }
    update(() => went);
    void start(went.now!);
  }, [carryingNow, host, start, update]);

  const nextRef = useRef(next);
  nextRef.current = next;
  const previousRef = useRef(previous);
  previousRef.current = previous;

  const setRepeat = useCallback((mode: RepeatMode) => update((q) => ({ ...q, repeat: mode })), [update]);
  const setKeepPlaying = useCallback((on: boolean) => update((q) => ({ ...q, keepPlaying: on })), [update]);
  const setSleep = useCallback((timer: SleepTimer | null) => setSleepState(timer), []);

  const live = carryingNow(queue.now) && host.mini !== null;
  const [rate, setRateState] = useState(prefs().rate);
  const setRate = useCallback((r: number) => {
    savePrefs({ rate: r });
    setRateState(r);
    host.setTextRate(r);
  }, [host]);
  const speed = queue.now?.kind === 'text'
    ? { rate: speedFor({ ...prefs(), rate }, queue.now.language), slowOffered: hasSlow(prefs(), queue.now.language) }
    : null;

  return useMemo(() => ({
    queue,
    live,
    playing: live && (host.mini?.playing ?? false),
    line: live && host.mini?.kind === 'text' ? host.mini.line : null,
    speed,
    problem,
    playNow, playNext, playLater, remove, move, clear, toggle, next, previous, stopNow, setRepeat, setKeepPlaying, sleep, setSleep, setRate,
  }), [queue, live, host.mini, speed?.rate, speed?.slowOffered, problem, playNow, playNext, playLater, remove, move, clear, toggle, next, previous, stopNow, setRepeat, setKeepPlaying, sleep, setSleep, setRate]); // eslint-disable-line react-hooks/exhaustive-deps -- `speed` is read through its parts
}

const Queue = createContext<AudioQueueHost | null>(null);

/** Up Next for every screen; inside ReaderPlayerProvider, whose player it plays on. */
export function AudioQueueProvider({ children }: { children: React.ReactNode }) {
  const value = useAudioQueueHost();
  return <Queue.Provider value={value}>{children}</Queue.Provider>;
}

export function useAudioQueue(): AudioQueueHost {
  const value = useContext(Queue);
  if (!value) throw new Error('useAudioQueue needs an AudioQueueProvider above it.');
  return value;
}
