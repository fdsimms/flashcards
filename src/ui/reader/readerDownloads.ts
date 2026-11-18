import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';
import type { Api, AudioLesson, AudioSource, Shelf, ShelfText } from '../../reader/api';
import { EMPTY_INDEX, lessonFile, lineFile, linesWithAudio, parseIndex, type DownloadIndex, type SavedText } from '../../reader/downloads';
import { wholeText } from '../../reader/offlineApi';
import { SLOW_RATE } from '../../reader/playbackRate';
import { connection } from '../connection';

/**
 * The phone's side of Read & Listen offline (src/reader/downloads.ts): the kept texts' recordings and
 * the kept lessons as files under the documents folder (not the caches folder, which iOS empties),
 * and an index of them beside the files. One copy for every screen; ShelfDownloads.tsx decides what
 * to fetch, and offlineApi.ts plays from it.
 */

const folder = () => new Directory(Paths.document, 'reader-offline');
const indexFile = () => new File(folder(), 'index.json');
/** A download that receives nothing for this long is given up: the network went dead. */
const STALLED_MS = 15_000;

let index: DownloadIndex = EMPTY_INDEX;
let loaded: Promise<void> | null = null;
const saving = new Set<number>();
const savingLessons = new Set<number>();
let savingVersion = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function write(next: DownloadIndex) {
  index = next;
  changed();
  try {
    const dir = folder();
    if (!dir.exists) dir.create({ intermediates: true });
    const f = indexFile();
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(next));
  } catch {
    // Kept for as long as the app runs; the next save tries again.
  }
}

function fileOf(name: string): File {
  return new File(folder(), ...name.split('/'));
}

/** Downloads `source` into the kept file `name`, giving up when nothing arrives for STALLED_MS. Returns its size. */
async function download(source: AudioSource, name: string): Promise<number> {
  if (connection.get().path === 'none') throw new Error('Offline');
  const target = fileOf(name);
  const parent = new Directory(folder(), ...name.split('/').slice(0, -1));
  if (!parent.exists) parent.create({ intermediates: true });
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), STALLED_MS); };
  idle();
  try {
    const file = await File.downloadFileAsync(source.uri, target, { headers: source.headers, idempotent: true, signal: abort.signal, onProgress: idle });
    return file.size ?? 0;
  } finally {
    clearTimeout(timer);
  }
}

function removeFile(name: string) {
  try {
    const f = fileOf(name);
    if (f.exists) f.delete();
  } catch {
    // Left behind: Remove all clears the folder.
  }
}

export const downloads = {
  get: (): DownloadIndex => index,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  load(): Promise<void> {
    loaded ??= (async () => {
      try {
        const f = indexFile();
        if (f.exists) { index = parseIndex(JSON.parse(await f.text())); changed(); }
      } catch {
        // Nothing kept that can be read: downloaded again.
      }
    })();
    return loaded;
  },
  /** A kept file's address, or null when it isn't there (iOS can't have removed it, but a crash mid-download can leave one out). */
  file(name: string): string | null {
    try {
      const f = fileOf(name);
      return f.exists ? f.uri : null;
    } catch {
      return null;
    }
  },
  saving: (): ReadonlySet<number> => saving,
  savingLessons: (): ReadonlySet<number> => savingLessons,
  savingVersion: () => savingVersion,

  setShelf(shelf: Shelf) { write({ ...index, shelves: { ...index.shelves, [shelf.language]: shelf } }); },

  /**
   * Keeps one shelf text: the text, each line's normal recording, and with `slow` each line's slow
   * one and its word times (which the server records the first time). Shown as on this iPhone only
   * once all of it is kept; a download cut short is finished next time.
   */
  async saveText(api: Api, card: ShelfText, slow: boolean): Promise<void> {
    if (saving.has(card.id)) return;
    saving.add(card.id); savingVersion++; changed();
    try {
      const text = await api.text(card.id);
      const before = index.texts.find((t) => t.id === card.id);
      const entry: SavedText = before && JSON.stringify(before.text) === JSON.stringify(text)
        ? { ...before, card }
        : { id: card.id, language: text.language, text, card, lines: [], slow: {}, complete: false, bytes: 0 };
      const keep = () => write({ ...index, texts: [...index.texts.filter((t) => t.id !== card.id), { ...entry }] });
      for (const line of linesWithAudio(text)) {
        if (!entry.lines.includes(line)) {
          entry.bytes += await download(api.audioSource(card.id, line, 1), lineFile(card.id, line, false));
          entry.lines = [...entry.lines, line];
        }
        if (slow && entry.slow[line] === undefined) {
          const { times } = await api.slowTimes(card.id, line);
          entry.bytes += await download(api.audioSource(card.id, line, SLOW_RATE), lineFile(card.id, line, true));
          entry.slow = { ...entry.slow, [line]: times };
        }
        keep();
      }
      entry.complete = wholeText(text, entry.lines, slow ? Object.keys(entry.slow).map(Number) : null);
      keep();
    } finally {
      saving.delete(card.id); savingVersion++; changed();
    }
  },

  dropTexts(ids: readonly number[]) {
    if (!ids.length) return;
    for (const id of ids) {
      try {
        const dir = new Directory(folder(), `text-${id}`);
        if (dir.exists) dir.delete();
      } catch {
        // Left behind: Remove all clears the folder.
      }
    }
    write({ ...index, texts: index.texts.filter((t) => !ids.includes(t.id)) });
  },

  async saveLesson(api: Api, lesson: AudioLesson): Promise<void> {
    if (savingLessons.has(lesson.id)) return;
    savingLessons.add(lesson.id); savingVersion++; changed();
    try {
      const bytes = await download(api.lessonAudio(lesson.id), lessonFile(lesson.id));
      write({ ...index, lessons: [...index.lessons.filter((l) => l.lesson.id !== lesson.id), { lesson, complete: true, bytes }] });
    } finally {
      savingLessons.delete(lesson.id); savingVersion++; changed();
    }
  },

  dropLessons(ids: readonly number[]) {
    if (!ids.length) return;
    for (const id of ids) removeFile(lessonFile(id));
    write({ ...index, lessons: index.lessons.filter((l) => !ids.includes(l.lesson.id)) });
  },

  /** Removes everything kept (Settings); the shelf's texts download again under the setting. */
  clear() {
    try {
      const dir = folder();
      if (dir.exists) dir.delete();
    } catch {
      // Whatever is left is written over.
    }
    write({ ...EMPTY_INDEX, shelves: index.shelves });
  },
};

/** What's kept, for a screen: changes as texts download. */
export function useDownloads(): DownloadIndex {
  useEffect(() => { void downloads.load(); }, []);
  return useSyncExternalStore(downloads.subscribe, downloads.get);
}

/** The texts and lessons downloading now. */
export function useSaving(): { texts: ReadonlySet<number>; lessons: ReadonlySet<number> } {
  useSyncExternalStore(downloads.subscribe, downloads.savingVersion);
  return { texts: downloads.saving(), lessons: downloads.savingLessons() };
}
