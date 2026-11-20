// Read & Listen offline (docs/read-and-listen/architecture.md, Offline): the shelf's texts and their
// line audio kept on the phone, so a text can be read and heard with no connection; audio lessons
// kept when Download is tapped; and what's done offline (a reading finished, a story choice) held
// until the server can be reached. The decisions are here, pure and tested; src/ui/readerDownloads.ts
// keeps the files, and offlineApi.ts answers from them.
import type { AudioLesson, Language, ReaderText, ReadingLog, Shelf, ShelfText, Word } from './api';
import type { NetworkPath } from '../core/connection';
import type { OfflineDownloads } from './prefs';
import { playOrder } from './shelf';

/** A shelf text kept on the phone. */
export interface SavedText {
  id: number;
  language: Language;
  /** The text as the server gave it, to open with no connection. */
  text: ReaderText;
  /** Its shelf card, for the shelf shown offline. */
  card: ShelfText;
  /** Lines whose normal-speed recording is kept. */
  lines: number[];
  /** Lines whose slow recording is kept, with its word times (the slow recording's own). */
  slow: Record<number, (Word['time'] | null)[]>;
  /** Every recording it needs is kept: only then is it shown as on this iPhone. */
  complete: boolean;
  bytes: number;
  /** Kept because it was played from Past texts or Listen again, not from the shelf: no shelf plan touches it, and only the latest PAST_KEPT are kept. */
  past?: boolean;
}

/** An audio lesson kept on the phone because Download was tapped. */
export interface SavedLesson {
  lesson: AudioLesson;
  complete: boolean;
  bytes: number;
}

export interface DownloadIndex {
  version: 1;
  texts: SavedText[];
  lessons: SavedLesson[];
  /** Each language's shelf as last read, for the shelf shown offline and for what to download. */
  shelves: Partial<Record<Language, Shelf>>;
}

export const EMPTY_INDEX: DownloadIndex = { version: 1, texts: [], lessons: [], shelves: {} };

export function parseIndex(raw: unknown): DownloadIndex {
  const o = raw as Partial<DownloadIndex> | null;
  if (!o || o.version !== 1 || !Array.isArray(o.texts) || !Array.isArray(o.lessons)) return EMPTY_INDEX;
  return {
    version: 1,
    texts: o.texts.filter((t) => typeof t?.id === 'number' && Array.isArray(t.lines) && t.text && t.card),
    lessons: o.lessons.filter((l) => typeof l?.lesson?.id === 'number'),
    shelves: o.shelves && typeof o.shelves === 'object' ? o.shelves : {},
  };
}

/** Whether the shelf's texts may be downloaded now, by themselves, under the setting. */
export function mayDownload(setting: OfflineDownloads, path: NetworkPath): boolean {
  if (setting === 'off' || path === 'none') return false;
  return setting === 'any' || path === 'wifi';
}

/**
 * Whether a text being played may be kept on the phone as it plays, whatever the connection: it is
 * already streaming over it, so keeping it costs about what listening does. Only Off, or no
 * connection, stops it (the Wi-Fi only setting is for downloads nobody asked for).
 */
export function mayKeepWhilePlaying(setting: OfflineDownloads, path: NetworkPath): boolean {
  return setting !== 'off' && path !== 'none';
}

/** A text's shelf card from the shelves last read, or null when it isn't on one (a past text). */
export function shelfCardFor(index: Pick<DownloadIndex, 'shelves'>, id: number): ShelfText | null {
  for (const shelf of Object.values(index.shelves)) {
    const found = shelf && shelfCards(shelf).find((t) => t.id === id);
    if (found) return found;
  }
  return null;
}

/** How many played past texts stay on the phone: the latest ones, so replaying a few doesn't pile up. */
export const PAST_KEPT = 10;

/** The shelf card for a text that isn't on a shelf (a past text), made from the text itself. */
export function cardOfText(text: ReaderText): ShelfText {
  return {
    id: text.id, title: text.title, topic: text.topic ?? text.title, topic_id: text.topicId, form: text.form,
    lines: text.lines.length, stretch: text.stretch, reason: text.reason ?? 'asked', coverage: text.coverage, episode: text.episode ?? 0,
  };
}

/** The played past texts to delete, oldest first, beyond the latest PAST_KEPT (the index lists a text where it was last saved). */
export function pastOverflow(index: Pick<DownloadIndex, 'texts'>): number[] {
  const past = index.texts.filter((t) => t.past);
  return past.slice(0, Math.max(0, past.length - PAST_KEPT)).map((t) => t.id);
}

/** Whether a tapped lesson Download asks first: on cellular, unless the setting is Any connection. */
export function asksBeforeLesson(setting: OfflineDownloads, path: NetworkPath): boolean {
  return path === 'cellular' && setting !== 'any';
}

/** A text's lines that have a recording (the reader skips the rest). */
export function linesWithAudio(text: Pick<ReaderText, 'lines'>): number[] {
  return text.lines.flatMap((l, i) => (l.audio ? [i] : []));
}

/** The shelf's texts, each with its card: the story's next episode first, as Play all goes. */
export function shelfCards(shelf: Pick<Shelf, 'story' | 'texts'>): ShelfText[] {
  return [...(shelf.story?.next ? [shelf.story.next] : []), ...shelf.texts];
}

/**
 * What to do after reading the shelf: the texts on it not kept yet (or kept only in part) to
 * download, in shelf order, and the kept texts of that language that have left it (read, or
 * removed) to delete. Texts of other languages are left alone: this shelf says nothing about them.
 */
export function planTexts(shelf: Shelf, index: Pick<DownloadIndex, 'texts'>): { fetch: ShelfText[]; drop: number[] } {
  const on = new Set(playOrder(shelf));
  const complete = new Set(index.texts.filter((t) => t.complete).map((t) => t.id));
  return {
    fetch: shelfCards(shelf).filter((t) => !complete.has(t.id)),
    drop: index.texts.filter((t) => !t.past && t.language === shelf.language && !on.has(t.id)).map((t) => t.id),
  };
}

/** The lessons to delete after reading a language's list: kept ones no longer on it (deleted on the server). */
export function lessonsGone(language: Language, listed: readonly AudioLesson[], index: Pick<DownloadIndex, 'lessons'>): number[] {
  const ids = new Set(listed.map((l) => l.id));
  return index.lessons.filter((s) => s.lesson.language === language && !ids.has(s.lesson.id)).map((s) => s.lesson.id);
}

/** The kept lessons with what the server just listed for each in place of the copy saved with it (the pauses an older lesson has had found since, `AudioLesson.pauses`); null when nothing changed. */
export function lessonsRefreshed(listed: readonly AudioLesson[], index: Pick<DownloadIndex, 'lessons'>): DownloadIndex['lessons'] | null {
  const byId = new Map(listed.map((l) => [l.id, l]));
  let changed = false;
  const lessons = index.lessons.map((s) => {
    const now = byId.get(s.lesson.id);
    if (!now || JSON.stringify(now) === JSON.stringify(s.lesson)) return s;
    changed = true;
    return { ...s, lesson: now };
  });
  return changed ? lessons : null;
}

/** A kept text's file for a line: its normal or its slow recording. */
export const lineFile = (textId: number, line: number, slow: boolean) => `text-${textId}/line-${line}${slow ? '.slow' : ''}.mp3`;
export const lessonFile = (lessonId: number) => `lesson-${lessonId}.mp3`;

/** How a text shows on the shelf: on this iPhone, being saved, or not saved yet. */
export type SavedState = 'saved' | 'saving' | 'waiting';

export function savedState(index: Pick<DownloadIndex, 'texts'>, id: number, saving: ReadonlySet<number>): SavedState {
  if (index.texts.some((t) => t.id === id && t.complete)) return 'saved';
  return saving.has(id) ? 'saving' : 'waiting';
}

export const SAVED_LABEL: Record<SavedState, string> = { saved: 'On this iPhone', saving: 'Saving', waiting: 'Not saved yet' };

/**
 * `language`'s shelf as it can be read with no connection: its last shelf read, keeping only the
 * texts kept whole, less those read since (`read`, waiting to be sent). Nothing being written, since
 * that needs the server. With no shelf read for it, its kept texts on their own; null when nothing
 * at all is known for it.
 */
export function offlineShelf(index: DownloadIndex, read: ReadonlySet<number>, language: Language): Shelf | null {
  const kept = new Map(index.texts.filter((t) => t.complete && !t.past && !read.has(t.id)).map((t) => [t.id, t]));
  const base = index.shelves[language];
  if (!base) {
    const texts = [...kept.values()].filter((t) => t.language === language);
    if (!texts.length) return null;
    const languages = Object.values(index.shelves).find((s) => s?.languages.length)?.languages ?? [];
    return { language, languages, texts: texts.map((t) => t.card), writing: [], story: null };
  }
  const next = base.story?.next && kept.has(base.story.next.id) ? base.story.next : null;
  return {
    ...base,
    texts: base.texts.filter((t) => kept.has(t.id)),
    writing: [],
    story: base.story ? { ...base.story, next, writing: false, stage: null, failed: null } : null,
  };
}

/** Settings' line about what's kept: "On this iPhone: 3 texts and 2 lessons, 4.1 MB." */
export function usageText(index: Pick<DownloadIndex, 'texts' | 'lessons'>): string {
  const texts = index.texts.filter((t) => t.complete);
  const lessons = index.lessons.filter((l) => l.complete);
  if (!texts.length && !lessons.length) return 'Nothing is on this iPhone yet.';
  const bytes = [...index.texts, ...index.lessons].reduce((n, x) => n + x.bytes, 0);
  const parts = [
    texts.length ? `${texts.length} ${texts.length === 1 ? 'text' : 'texts'}` : '',
    lessons.length ? `${lessons.length} ${lessons.length === 1 ? 'lesson' : 'lessons'}` : '',
  ].filter(Boolean);
  return `On this iPhone: ${parts.join(' and ')}, ${megabytes(bytes)}.`;
}

export function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return mb < 0.1 ? 'under 0.1 MB' : `${mb.toFixed(1)} MB`;
}

/** Something done in Read & Listen offline, held until the server answers (sent in order: a choice before its reading). */
export type HeldReaderAction =
  | { kind: 'language'; language: Language }
  | { kind: 'choice'; textId: number; choice: number }
  | { kind: 'reading'; textId: number; log: ReadingLog }
  | { kind: 'listen'; textId: number; key?: string };

export function parseHeldReader(raw: unknown): HeldReaderAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is HeldReaderAction => (a?.kind === 'language' && typeof a.language === 'string') || (typeof a?.textId === 'number'
    && ((a.kind === 'choice' && typeof a.choice === 'number') || (a.kind === 'reading' && a.log && typeof a.log === 'object') || a.kind === 'listen')));
}

/** The texts whose reading is waiting to be sent: read, so off the shelf shown offline. */
export const readOffline = (held: readonly HeldReaderAction[]): Set<number> =>
  new Set(held.flatMap((a) => (a.kind === 'reading' ? [a.textId] : [])));

/**
 * The languages whose shelves to keep: every one with texts ready on the server (as the shelf just
 * read counts them), and any with texts already kept, so their copies are checked and dropped once read.
 */
export function languagesToKeep(shelf: Pick<Shelf, 'language' | 'languages'>, index: Pick<DownloadIndex, 'texts'>): Language[] {
  const ready = shelf.languages.filter((l) => l.ready > 0).map((l) => l.code);
  const kept = index.texts.map((t) => t.language);
  return [...new Set([shelf.language, ...ready, ...kept])];
}
