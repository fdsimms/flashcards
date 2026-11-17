import { studyDayStart } from '../core/day';
import type { KanjiReadings, Learned } from '../core/furigana';
import type { Assignment, Subject } from './subjects';

/**
 * What furigana needs from WaniKani (src/core/furigana.ts), kept on the phone and read again once a
 * study day while the setting is on: every kanji's readings, to split a word's reading kanji by
 * kanji, and the kanji and vocabulary at Guru or above, which "not learned in WaniKani" leaves bare.
 * Read only: nothing is sent to WaniKani.
 */
export interface FuriganaData {
  version: 1;
  savedAt: string;
  /** Each kanji with its readings, as WaniKani writes them. */
  kanji: [string, string[]][];
  learnedKanji: string[];
  learnedVocabulary: string[];
}

/** The data from WaniKani's kanji, the items at Guru or above, and those items' subjects. */
export function buildFuriganaData(kanji: Subject[], passed: Assignment[], passedSubjects: Subject[], now: Date): FuriganaData {
  const byId = new Map([...kanji, ...passedSubjects].map((s) => [s.id, s]));
  const learned = (types: Assignment['subjectType'][]) => [...new Set(passed
    .filter((a) => types.includes(a.subjectType))
    .map((a) => byId.get(a.subjectId)?.characters)
    .filter((c): c is string => !!c))];
  return {
    version: 1,
    savedAt: now.toISOString(),
    kanji: kanji.filter((s) => s.characters && s.readings.length).map((s) => [s.characters!, s.readings.map((r) => r.reading)]),
    learnedKanji: learned(['kanji']),
    learnedVocabulary: learned(['vocabulary', 'kana_vocabulary']),
  };
}

/** The vocabulary subjects to read for `passed` (kanji come with every kanji's subject already). */
export function vocabularyIds(passed: Assignment[]): number[] {
  return passed.filter((a) => a.subjectType === 'vocabulary' || a.subjectType === 'kana_vocabulary').map((a) => a.subjectId);
}

export function parseFuriganaData(raw: string | null | undefined): FuriganaData | null {
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (o?.version !== 1 || typeof o.savedAt !== 'string') return null;
    if (![o.kanji, o.learnedKanji, o.learnedVocabulary].every(Array.isArray)) return null;
    return o as FuriganaData;
  } catch {
    return null;
  }
}

/** Whether the data is from before the study day `now` is in, or there is none: then it's read again. */
export function furiganaStale(data: FuriganaData | null, now: Date, dayStartsAtHour: number): boolean {
  return !data || new Date(data.savedAt) < studyDayStart(now, dayStartsAtHour);
}

export function learnedOf(data: FuriganaData): Learned {
  return { kanji: new Set(data.learnedKanji), vocabulary: new Set(data.learnedVocabulary) };
}

export function kanjiReadingsOf(data: FuriganaData): KanjiReadings {
  const map = new Map(data.kanji);
  return (k) => map.get(k);
}
