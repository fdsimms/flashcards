import { useCallback, useSyncExternalStore } from 'react';
import { addLessonWord, removeLessonWord, type LessonWord } from '../../core/lessonWords';
import type { Language } from '../../reader/api';

/**
 * The words the next audio lesson is asked to teach, per language: one copy for the Lessons screen
 * and the two sheets that fill it (the deck picker and typing one in), so they agree. A draft only:
 * it isn't saved, and it empties once the lesson is asked for.
 */
const NONE: LessonWord[] = [];
let drafts: Partial<Record<Language, LessonWord[]>> = {};
const listeners = new Set<() => void>();

function set(language: Language, words: LessonWord[]) {
  drafts = { ...drafts, [language]: words };
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useLessonWords(language: Language) {
  const words = useSyncExternalStore(subscribe, () => drafts[language] ?? NONE);
  /** Adds a word; throws a `Refusal` saying why when it can't be added. */
  const add = useCallback((word: LessonWord) => set(language, addLessonWord(drafts[language] ?? NONE, word)), [language]);
  const remove = useCallback((text: string) => set(language, removeLessonWord(drafts[language] ?? NONE, text)), [language]);
  const clear = useCallback(() => set(language, NONE), [language]);
  return { words, add, remove, clear };
}
