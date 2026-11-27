import { studyDayStart } from '../core/day';
import type { WritingItem } from '../tools/writing';
import type { Subject } from './subjects';

/**
 * The kanji Writing by hand asks for: those in the WaniKani levels the learner has reached, each
 * with its main meaning and reading. Kept on the phone and read again once a study day, or when
 * the level changes, while a token is entered. Read only: nothing is sent to WaniKani, and writing
 * one is never an answer there.
 */
export interface WritingKanji {
  version: 1;
  savedAt: string;
  /** The learner's level when it was read. */
  level: number;
  kanji: [characters: string, meaning: string, reading: string][];
}

const main = <T extends { primary: boolean }>(list: T[]): T | undefined => list.find((x) => x.primary) ?? list[0];

/** The kanji up to `level`, in WaniKani's order: a kanji with no meaning or reading in the expected shape is left out. */
export function buildWritingKanji(kanji: Subject[], level: number, now: Date): WritingKanji {
  const reached = kanji
    .filter((s) => s.type === 'kanji' && s.characters && s.level > 0 && s.level <= level)
    .sort((a, b) => a.level - b.level || a.lessonPosition - b.lessonPosition);
  return {
    version: 1,
    savedAt: now.toISOString(),
    level,
    kanji: reached.flatMap((s): WritingKanji['kanji'] => {
      const meaning = main(s.meanings)?.meaning;
      const reading = main(s.readings)?.reading;
      return meaning && reading ? [[s.characters!, meaning, reading]] : [];
    }),
  };
}

export function parseWritingKanji(raw: string | null | undefined): WritingKanji | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (o?.version !== 1 || typeof o.savedAt !== 'string' || typeof o.level !== 'number' || !Array.isArray(o.kanji)) return null;
    if (!o.kanji.every((k: unknown) => Array.isArray(k) && k.length === 3 && k.every((v) => typeof v === 'string'))) return null;
    return o as WritingKanji;
  } catch {
    return null;
  }
}

/** Whether the copy is from before the study day `now` is in, was made at another level, or there is none: then it's read again. */
export function writingKanjiStale(data: WritingKanji | null, level: number, now: Date, dayStartsAtHour: number): boolean {
  return !data || data.level !== level || new Date(data.savedAt) < studyDayStart(now, dayStartsAtHour);
}

/** Each kanji as a question: asked by its meaning, with its reading under it, which the play button reads. */
export function kanjiItems(data: WritingKanji): WritingItem[] {
  return data.kanji.map(([characters, meaning, reading]) => ({
    text: characters,
    prompt: meaning,
    detail: reading,
    say: reading,
    patterns: [`kanji:${characters}`],
  }));
}
