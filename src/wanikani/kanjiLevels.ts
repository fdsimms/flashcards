import { studyDayStart } from '../core/day';
import type { Subject } from './subjects';

/**
 * Which WaniKani level teaches each kanji, for the tag beside a kanji in Read & Listen's word popup.
 * Kept on the phone and read again once a study day while a token is entered. Read only: nothing is
 * sent to WaniKani. (furigana.ts keeps its own copy of the kanji for a setting that may be off, so
 * this one is separate.)
 */
export interface KanjiLevels {
  version: 1;
  savedAt: string;
  levels: [string, number][];
}

/** The levels from WaniKani's kanji subjects (a radical drawn as an image has no characters and isn't one). */
export function buildKanjiLevels(kanji: Subject[], now: Date): KanjiLevels {
  return {
    version: 1,
    savedAt: now.toISOString(),
    levels: kanji.filter((s) => s.type === 'kanji' && s.characters && s.level > 0).map((s) => [s.characters!, s.level]),
  };
}

export function parseKanjiLevels(raw: string | null | undefined): KanjiLevels | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (o?.version !== 1 || typeof o.savedAt !== 'string' || !Array.isArray(o.levels)) return null;
    return o as KanjiLevels;
  } catch {
    return null;
  }
}

/** Whether the copy is from before the study day `now` is in, or there is none: then it's read again. */
export function kanjiLevelsStale(data: KanjiLevels | null, now: Date, dayStartsAtHour: number): boolean {
  return !data || new Date(data.savedAt) < studyDayStart(now, dayStartsAtHour);
}

export function levelsOf(data: KanjiLevels): ReadonlyMap<string, number> {
  return new Map(data.levels);
}
