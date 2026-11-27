// Up Next (docs/read-and-listen/architecture.md, Up Next): one queue of Read & Listen texts and
// audio lessons that the shared player (src/ui/useReaderPlayer.tsx) plays through in order, the way
// a podcast app plays its queue. What's in it, the order, where each item stopped, what was played
// and the repeat mode are decided here; src/ui/useAudioQueue.ts keeps it on the phone and drives
// the player. Pure, so it's tested. Nothing here grades a card: a text played to its end is logged
// as listened to (`listenLog`), as the reader logs a reading, and never as a rating.
import type { AudioLesson, Form, GlossLanguage, Language, PastText, ReadingLog, ShelfText } from './api';
import { clock } from './lessons';

/**
 * A Read & Listen text. `from` says how it's logged once played to its end: a shelf text is read
 * (listen only), a past text is heard again (relisten), and null is logged by nobody (the reader
 * already logged it before handing it over).
 */
export type QueuedText = {
  kind: 'text';
  textId: number;
  title: string;
  language: GlossLanguage;
  form?: Form;
  /** Its number of lines, when known (a shelf text's card says). */
  lines?: number;
  from: 'shelf' | 'past' | null;
  /** A past text as the list gave it, so the reader can open it as one (`ReaderSource` 'past'). */
  past?: PastText;
  /** The line it stopped at, to start again from. */
  resume?: number;
};

export type QueuedLesson = {
  kind: 'lesson';
  lesson: AudioLesson;
  /** Where it stopped, in seconds. */
  resume?: number;
};

export type QueueItem = QueuedText | QueuedLesson;

/** Repeat: off, the whole queue (a played item goes to the end again), or the item playing. */
export type RepeatMode = 'off' | 'all' | 'one';

export type AudioQueue = {
  version: 1;
  /** What's playing, or paused, now; null when the queue is empty. */
  now: QueueItem | null;
  /** Up Next, in order. */
  next: QueueItem[];
  /** Recently played, newest first, without their resume points. */
  history: QueueItem[];
  repeat: RepeatMode;
  /** Once Up Next runs out after a shelf text, go on with the shelf's next unread text in that language. */
  keepPlaying: boolean;
};

export const EMPTY_QUEUE: AudioQueue = { version: 1, now: null, next: [], history: [], repeat: 'off', keepPlaying: false };

/** How many items Recently played keeps. */
export const HISTORY_LIMIT = 20;

/** One key per text or lesson, so the same one is never in the queue twice. */
export function keyOf(item: QueueItem): string {
  return item.kind === 'text' ? `text:${item.textId}` : `lesson:${item.lesson.id}`;
}

export function titleOf(item: QueueItem): string {
  return item.kind === 'text' ? item.title : item.lesson.title;
}

export function languageOf(item: QueueItem): GlossLanguage {
  return item.kind === 'text' ? item.language : item.lesson.language;
}

const without = (list: readonly QueueItem[], key: string) => list.filter((i) => keyOf(i) !== key);
const fresh = (item: QueueItem): QueueItem => {
  const { resume: _resume, ...rest } = item;
  return rest as QueueItem;
};

/** The queue's copy of `item`, when it's there: it holds where that one stopped. */
function queued(q: AudioQueue, item: QueueItem): QueueItem {
  const key = keyOf(item);
  return q.next.find((i) => keyOf(i) === key) ?? item;
}

/**
 * Play `item` now. What was playing goes to the top of Up Next, keeping where it stopped, as a
 * podcast app puts an interrupted episode back.
 */
export function playNow(q: AudioQueue, item: QueueItem): AudioQueue {
  const key = keyOf(item);
  if (q.now && keyOf(q.now) === key) return q;
  const chosen = queued(q, item);
  return { ...q, now: chosen, next: [...(q.now ? [q.now] : []), ...without(q.next, key)] };
}

/** Put `item` after the one playing (it plays now, paused, when nothing is). */
export function playNext(q: AudioQueue, item: QueueItem): AudioQueue {
  const key = keyOf(item);
  if (!q.now) return { ...q, now: queued(q, item), next: without(q.next, key) };
  if (keyOf(q.now) === key) return q;
  return { ...q, next: [queued(q, item), ...without(q.next, key)] };
}

/** Put `item` at the end of Up Next (it plays now, paused, when nothing is). */
export function playLater(q: AudioQueue, item: QueueItem): AudioQueue {
  const key = keyOf(item);
  if (!q.now) return { ...q, now: queued(q, item), next: without(q.next, key) };
  if (keyOf(q.now) === key) return q;
  return { ...q, next: [...without(q.next, key), queued(q, item)] };
}

/** Whether `key` is playing or in Up Next. */
export function has(q: AudioQueue, key: string): boolean {
  return (q.now !== null && keyOf(q.now) === key) || q.next.some((i) => keyOf(i) === key);
}

/** Takes `key` out. Taking out the one playing makes the first of Up Next the one playing (paused). */
export function remove(q: AudioQueue, key: string): AudioQueue {
  if (q.now && keyOf(q.now) === key) {
    const [now = null, ...next] = q.next;
    return { ...q, now, next };
  }
  return { ...q, next: without(q.next, key) };
}

/** Moves Up Next's item at `from` to `to`, both indexes into `next`. */
export function move(q: AudioQueue, from: number, to: number): AudioQueue {
  if (from === to || from < 0 || from >= q.next.length) return q;
  const next = [...q.next];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return { ...q, next };
}

/** Empties Up Next (the one playing stays), returning what was taken out, for Undo. */
export function clearNext(q: AudioQueue): { queue: AudioQueue; removed: QueueItem[] } {
  return { queue: { ...q, next: [] }, removed: q.next };
}

/** Undo for Clear: what was taken out goes back after anything added since, never twice. */
export function restoreNext(q: AudioQueue, removed: readonly QueueItem[]): AudioQueue {
  const restored = removed.filter((i) => !has(q, keyOf(i)));
  if (!q.now) {
    const [now = null, ...rest] = restored;
    return { ...q, now, next: [...q.next, ...rest] };
  }
  return { ...q, next: [...q.next, ...restored] };
}

function remember(history: readonly QueueItem[], item: QueueItem): QueueItem[] {
  return [fresh(item), ...without(history, keyOf(item))].slice(0, HISTORY_LIMIT);
}

/**
 * The one playing has finished (played to its end, `played`), or was skipped past with the next
 * button. Either way it goes to Recently played, and to the end of Up Next again under Repeat all;
 * the first of Up Next is then the one playing. Repeat one is the player's to do: it starts the
 * item again rather than calling this.
 */
export function advance(q: AudioQueue): AudioQueue {
  if (!q.now) return q;
  const done = q.now;
  const [now = null, ...next] = q.next;
  const again = q.repeat === 'all' ? [fresh(done)] : [];
  // Under Repeat all a queue of one plays itself again.
  if (!now && again.length > 0) return { ...q, now: again[0], next: [], history: remember(q.history, done) };
  return { ...q, now, next: [...next, ...again], history: remember(q.history, done) };
}

/**
 * The previous button, past the start of the one playing: the last played plays again from its
 * start, and the one playing goes back to the top of Up Next. Null when nothing was played.
 */
export function back(q: AudioQueue): AudioQueue | null {
  const [last, ...history] = q.history;
  if (!last) return null;
  const key = keyOf(last);
  const next = q.now ? [q.now, ...without(q.next, key)] : without(q.next, key);
  return { ...q, now: fresh(last), next, history };
}

/** How far into an item the previous button starts it again instead of going back to the last one. */
export const RESTART_SECONDS = 3;

/**
 * Whether the previous button starts the one playing again rather than going back: past the first
 * few seconds of a lesson, or past a text's first line, as a music app's does.
 */
export function backRestarts(position: { kind: 'text'; line: number; first: number } | { kind: 'lesson'; seconds: number }): boolean {
  return position.kind === 'lesson' ? position.seconds > RESTART_SECONDS : position.line > position.first;
}

/** Keeps where `key` stopped (a line, or seconds), to start again from there. */
export function setResume(q: AudioQueue, key: string, resume: number | null): AudioQueue {
  const set = (i: QueueItem): QueueItem => (keyOf(i) !== key ? i : resume === null ? fresh(i) : { ...i, resume });
  if (q.now && keyOf(q.now) === key) {
    const now = set(q.now);
    return now.resume === q.now.resume ? q : { ...q, now };
  }
  if (!q.next.some((i) => keyOf(i) === key)) return q;
  return { ...q, next: q.next.map(set) };
}

/** The repeat button's next mode, as a music app steps it: off, all, one, off. */
export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

export function repeatLabel(mode: RepeatMode): string {
  return mode === 'off' ? 'Repeat' : mode === 'all' ? 'Repeat all' : 'Repeat one';
}

/** A shelf text as a queue item. */
export function shelfItem(text: Pick<ShelfText, 'id' | 'title' | 'form' | 'lines'>, language: GlossLanguage): QueuedText {
  return { kind: 'text', textId: text.id, title: text.title, language, form: text.form, lines: text.lines, from: 'shelf' };
}

/** A text read before, as a queue item: played to its end it counts as heard again. */
export function pastItem(text: PastText, language: GlossLanguage): QueuedText {
  return { kind: 'text', textId: text.id, title: text.title, language, form: text.form, from: 'past', past: text };
}

export function lessonItem(lesson: AudioLesson): QueuedLesson {
  return { kind: 'lesson', lesson };
}

/**
 * What Keep playing the shelf plays after `finished` once Up Next is empty: the shelf's first text
 * not played lately and not the one just finished. The story's next episode is left to its own
 * card, since it can end on a choice. Null when there's none, or `finished` isn't a shelf text.
 */
export function keepPlayingPick(q: Pick<AudioQueue, 'history' | 'next' | 'now'>, finished: QueueItem, shelf: { language: GlossLanguage; texts: ShelfText[] }): ShelfText | null {
  if (finished.kind !== 'text' || finished.from !== 'shelf' || shelf.language !== finished.language) return null;
  const skip = new Set([keyOf(finished), ...q.history.map(keyOf), ...q.next.map(keyOf), ...(q.now ? [keyOf(q.now)] : [])]);
  return shelf.texts.find((t) => !skip.has(`text:${t.id}`)) ?? null;
}

const FORMS: Record<Form, string> = { dialogue: 'Dialogue', story: 'Story' };

/** A row's second line: what it is, and where it starts again when it was stopped partway. */
export function itemDetail(item: QueueItem): string {
  if (item.kind === 'lesson') {
    const length = clock(item.lesson.duration_ms / 1000);
    return item.resume ? `Lesson · started, ${clock(item.resume)} of ${length}` : `Lesson · ${length}`;
  }
  const kind = item.form ? FORMS[item.form] : 'Text';
  if (item.resume) return `${kind} · started, line ${item.resume + 1}`;
  return item.lines ? `${kind} · ${item.lines} lines` : kind;
}

/** "then 3 more" under the mini-player's title, or null with nothing after the one playing. */
export function moreAfter(q: Pick<AudioQueue, 'next'>): string | null {
  const n = q.next.length;
  return n === 0 ? null : `then ${n} more`;
}

/**
 * How a text played to its end from the queue is logged: a shelf text as read by listening (its
 * words weren't shown, so nothing was looked up or marked), a past text as heard again, and one the
 * reader already logged, or a story episode that ends on a choice (which only the reader can make),
 * not at all. Never a rating.
 */
export function listenLog(item: QueuedText, seconds: number, rate: number, endsOnChoice: boolean):
  | { kind: 'reading'; log: ReadingLog }
  | { kind: 'listen' }
  | null {
  if (item.from === 'past') return { kind: 'listen' };
  if (item.from !== 'shelf' || endsOnChoice) return null;
  return {
    kind: 'reading',
    log: { finished: true, words_glossed: [], words_flagged: [], audio_speed: rate, listen_only: true, seconds: Math.max(0, Math.round(seconds)) },
  };
}

// The sleep timer: pause after some minutes, or at the end of the item playing.
export type SleepTimer = { kind: 'minutes'; endsAt: number } | { kind: 'item' };

export const SLEEP_MINUTES = [15, 30, 45, 60] as const;

export function sleepIn(minutes: number, now: number): SleepTimer {
  return { kind: 'minutes', endsAt: now + minutes * 60_000 };
}

/** The chip's label: minutes left (rounded up), or End of item. */
export function sleepLabel(timer: SleepTimer | null, now: number): string {
  if (!timer) return 'Sleep timer';
  if (timer.kind === 'item') return 'End of item';
  return `${Math.max(1, Math.ceil((timer.endsAt - now) / 60_000))} min`;
}

/** Milliseconds until a minutes timer pauses (0 once due); null for none or End of item. */
export function sleepDelay(timer: SleepTimer | null, now: number): number | null {
  return timer?.kind === 'minutes' ? Math.max(0, timer.endsAt - now) : null;
}

function validItem(raw: unknown): QueueItem | null {
  const o = raw as (Partial<Omit<QueuedText, 'kind'>> & Partial<Omit<QueuedLesson, 'kind'>> & { kind?: unknown }) | null;
  if (!o || typeof o !== 'object') return null;
  const resume = typeof o.resume === 'number' && o.resume > 0 ? { resume: o.resume } : {};
  if (o.kind === 'text' && typeof o.textId === 'number' && typeof o.title === 'string' && typeof o.language === 'string') {
    const from = o.from === 'shelf' || o.from === 'past' ? o.from : null;
    return {
      kind: 'text', textId: o.textId, title: o.title, language: o.language, from,
      ...(o.form ? { form: o.form } : {}),
      ...(typeof o.lines === 'number' ? { lines: o.lines } : {}),
      ...(o.past && typeof o.past.id === 'number' ? { past: o.past } : {}),
      ...resume,
    };
  }
  if (o.kind === 'lesson' && o.lesson && typeof o.lesson.id === 'number' && typeof o.lesson.title === 'string') {
    return { kind: 'lesson', lesson: o.lesson, ...resume };
  }
  return null;
}

function validList(raw: unknown, limit = Infinity): QueueItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: QueueItem[] = [];
  for (const r of raw) {
    const item = validItem(r);
    if (!item || seen.has(keyOf(item))) continue;
    seen.add(keyOf(item));
    out.push(item);
  }
  return out.slice(0, limit);
}

/** The queue as kept on the phone; anything unreadable is dropped rather than played. */
export function parseQueue(raw: unknown): AudioQueue {
  const o = raw as Partial<AudioQueue> | null;
  if (!o || o.version !== 1) return EMPTY_QUEUE;
  const now = validItem(o.now);
  const next = validList(o.next).filter((i) => !now || keyOf(i) !== keyOf(now));
  return {
    version: 1,
    now: now ?? next.shift() ?? null,
    next,
    history: validList(o.history, HISTORY_LIMIT).map(fresh),
    repeat: o.repeat === 'all' || o.repeat === 'one' ? o.repeat : 'off',
    keepPlaying: o.keepPlaying === true,
  };
}

/**
 * Where a row dragged `dy` points from `from` lands in a list of `count` rows `rowHeight` tall: the
 * row it's over once it has moved past half of the next one.
 */
export function dropIndex(from: number, dy: number, rowHeight: number, count: number): number {
  if (rowHeight <= 0 || count <= 0) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / rowHeight)));
}

/** How far the row at `index` moves aside (in rows) while the one at `from` is held over `to`. */
export function shiftFor(index: number, from: number, to: number): -1 | 0 | 1 {
  if (index === from) return 0;
  if (from < to && index > from && index <= to) return -1;
  if (from > to && index >= to && index < from) return 1;
  return 0;
}
