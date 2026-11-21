// Read & Listen's server, as the app sees it once texts are kept on the phone (downloads.ts): the
// same calls, answered from what's kept when the server can't be reached, and what's sent while
// it can't be (a reading, a story choice) held to send later. Every screen gets it from useReader,
// so none of them needs to know. Pure, so it's tested; the files are reached through `deps`.
import { isOffline } from '../core/held';
import { ApiError, type Api, type AudioLesson, type Language, type ReaderText, type Settings, type SettingsChange, type Shelf } from './api';
import { linesWithAudio, offlineShelf, readOffline, type DownloadIndex, type HeldReaderAction } from './downloads';
import { isSlow } from './playbackRate';

export interface OfflineDeps {
  /** Whether the server can't be reached now (connection.cantReachHome). */
  unreachable: () => boolean;
  index: () => DownloadIndex;
  /** A kept file's address, or null when it isn't kept. */
  file: (name: string) => string | null;
  held: () => readonly HeldReaderAction[];
  hold: (action: HeldReaderAction) => Promise<void>;
  /** The shelf as just read from the server, to keep for offline and to download from. */
  shelfRead: (shelf: Shelf) => void;
  /** A kept text the server now gives differently (its audio was recorded again): drop the copy. */
  stale: (id: number) => void;
  /** A language's lessons as just read from the server, so kept ones deleted there are dropped and the rest brought up to date. */
  lessonsRead: (language: Language, lessons: AudioLesson[]) => void;
  /** The server's settings as last read (kept on the phone, useReader), for switching language offline. */
  settings: () => Settings | null;
}

/** An id for one listen, made on the phone: the server counts a listen it has seen under it once. */
export const listenKey = (now = Date.now(), random: () => number = Math.random): string => `${now.toString(36)}-${random().toString(36).slice(2, 12)}`;

const notKept = () => new ApiError("This text isn't on this iPhone, and the server can't be reached. Try again when you're back online.", 0);

export function withOffline(api: Api, deps: OfflineDeps): Api {
  const kept = (id: number) => deps.index().texts.find((t) => t.id === id && t.complete) ?? null;
  /** A text's saved recordings, whole or not: a text being kept as it plays (useKeepPlaying) plays the lines saved so far from the phone, so it carries on if the connection drops. */
  const saved = (id: number) => deps.index().texts.find((t) => t.id === id) ?? null;
  /** The reader's language: one switched to offline (held to send), else the server's as last read. */
  const language = (): Language | null => {
    const switched = deps.held().filter((a) => a.kind === 'language').at(-1);
    return switched?.kind === 'language' ? switched.language : deps.settings()?.language ?? null;
  };
  const shelfOffline = (): Shelf | null => {
    const lang = language();
    if (!lang) return null;
    const shelf = offlineShelf(deps.index(), readOffline(deps.held()), lang);
    if (shelf) return shelf;
    // A language with nothing kept: an empty shelf to say so, with the languages to switch to.
    const languages = Object.values(deps.index().shelves).find((x) => x?.languages.length)?.languages ?? [];
    return { language: lang, languages, texts: [], writing: [], story: null };
  };

  /** Sends now, or holds when the server can't be reached or something for this text is already waiting (so a choice goes before its reading). */
  const sendOrHold = async (action: Exclude<HeldReaderAction, { kind: 'language' } | { kind: 'lessonHeard' }>, send: () => Promise<void>): Promise<void> => {
    if (deps.unreachable() || deps.held().some((a) => a.kind !== 'language' && a.kind !== 'lessonHeard' && a.textId === action.textId)) return deps.hold(action);
    try {
      await send();
    } catch (e) {
      if (isOffline(e)) return deps.hold(action);
      throw e;
    }
  };

  return {
    ...api,
    text: async (id: number): Promise<ReaderText> => {
      const copy = kept(id);
      if (deps.unreachable()) {
        if (copy) return copy.text;
        throw notKept();
      }
      try {
        const fresh = await api.text(id);
        if (copy && JSON.stringify(copy.text) !== JSON.stringify(fresh)) deps.stale(id);
        return fresh;
      } catch (e) {
        if (copy && isOffline(e)) return copy.text;
        throw e;
      }
    },
    shelf: async (): Promise<Shelf> => {
      const offline = shelfOffline();
      // A language switched to offline isn't the server's yet: its kept texts until the switch is sent.
      const switched = deps.held().some((a) => a.kind === 'language');
      if ((deps.unreachable() || switched) && offline) return offline;
      try {
        const shelf = await api.shelf();
        deps.shelfRead(shelf);
        return shelf;
      } catch (e) {
        if (offline && isOffline(e)) return offline;
        throw e;
      }
    },
    settings: async (): Promise<Settings> => {
      const copy = deps.settings();
      const lang = language();
      const local = copy && lang ? { ...copy, language: lang } : null;
      if (deps.unreachable() && local) return local;
      try {
        return await api.settings();
      } catch (e) {
        if (local && isOffline(e)) return local;
        throw e;
      }
    },
    updateSettings: async (change: SettingsChange): Promise<Settings> => {
      // Switching language is the one change kept offline: it's how the kept texts of another
      // language are reached. The switch is sent when the server answers (HeldWork).
      const onlyLanguage = change.language !== undefined && Object.keys(change).length === 1;
      const copy = deps.settings();
      const hold = async () => {
        await deps.hold({ kind: 'language', language: change.language! });
        return { ...copy!, language: change.language! };
      };
      if (onlyLanguage && copy && (deps.unreachable() || deps.held().some((a) => a.kind === 'language'))) return hold();
      try {
        return await api.updateSettings(change);
      } catch (e) {
        if (onlyLanguage && copy && isOffline(e)) return hold();
        throw e;
      }
    },
    logReading: (id, log) => sendOrHold({ kind: 'reading', textId: id, log }, () => api.logReading(id, log)),
    // One id for the listen, whether it's sent now or held and sent later (and then maybe twice).
    logListen: (id, key = listenKey()) => sendOrHold({ kind: 'listen', textId: id, key }, () => api.logListen(id, key)),
    // A lesson kept on the phone can be played with no connection: that it was heard waits to be sent.
    lessonHeard: async (id) => {
      const action = { kind: 'lessonHeard' as const, lessonId: id };
      if (deps.unreachable()) return deps.hold(action);
      try {
        await api.lessonHeard(id);
      } catch (e) {
        if (isOffline(e)) return deps.hold(action);
        throw e;
      }
    },
    chooseNext: (id, choice) => sendOrHold({ kind: 'choice', textId: id, choice }, () => api.chooseNext(id, choice)),
    audioSource: (id: number, line: number, rate = 1) => {
      const copy = saved(id);
      const slow = isSlow(rate);
      if (copy && (slow ? copy.slow[line] !== undefined : copy.lines.includes(line))) {
        const uri = deps.file(slowOrNormal(id, line, slow));
        if (uri) return { uri };
      }
      return api.audioSource(id, line, rate);
    },
    slowTimes: async (id: number, line: number) => {
      const times = saved(id)?.slow[line];
      if (times) return { times };
      if (deps.unreachable()) throw new ApiError("The slow recording isn't on this iPhone.", 0);
      return api.slowTimes(id, line);
    },
    lessons: async (language) => {
      const savedOf = () => ({
        languages: language ? [language] : [],
        lessons: deps.index().lessons.filter((s) => s.complete && (!language || s.lesson.language === language)).map((s) => s.lesson),
      });
      if (deps.unreachable()) return savedOf();
      try {
        const listed = await api.lessons(language);
        if (language) deps.lessonsRead(language, listed.lessons);
        return listed;
      } catch (e) {
        if (isOffline(e)) return savedOf();
        throw e;
      }
    },
    lessonAudio: (id: number) => {
      const uri = deps.index().lessons.some((s) => s.lesson.id === id && s.complete) ? deps.file(`lesson-${id}.mp3`) : null;
      return uri ? { uri } : api.lessonAudio(id);
    },
  };
}

const slowOrNormal = (id: number, line: number, slow: boolean) => `text-${id}/line-${line}${slow ? '.slow' : ''}.mp3`;

/** Whether a kept text has every recording it needs: each line's normal one, and its slow one where slow is kept. */
export function wholeText(text: ReaderText, lines: readonly number[], slowLines: readonly number[] | null): boolean {
  const need = linesWithAudio(text);
  return need.every((l) => lines.includes(l)) && (slowLines === null || need.every((l) => slowLines.includes(l)));
}
