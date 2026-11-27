import type { useRouter } from 'expo-router';
import { endPath, FIRST_WORDS, FROM_ZERO_NEW_PER_DAY, lessonScene, nextLessonWords, startPath, updatePath, type DeckWord, type FromZero } from '../core/fromZero';
import type { Api, CommonCount, Language, Settings } from '../reader/api';
import { loadParticle } from '../reader/lessonStorage';
import { updateFromZero } from './fromZeroStorage';

/**
 * What starting a language from zero does (src/core/fromZero.ts), shared by the empty deck's Start from zero
 * and the path on Today. Read & Listen's settings change on its server and come back with the answer, which
 * the caller hands to `reader.setSettings`, so every screen reads the same.
 */

/** The first words' screen (Suggested words), with the first `FIRST_WORDS` ticked. */
export function openFirstWords(router: ReturnType<typeof useRouter>, deck: string, language: Language): void {
  router.push({ pathname: '/read-new-words', params: { deck, language, perDay: String(FROM_ZERO_NEW_PER_DAY), first: String(FIRST_WORDS) } });
}

/**
 * Starts `language` from zero on `deck`: Read & Listen's deck for the language becomes `deck`, its
 * common-words setting goes to 0 (kept, to put back when texts start) so suggestions begin at word 1,
 * and the deck takes `FROM_ZERO_NEW_PER_DAY` new cards a day (`setNewPerDay`, fromZeroDeck.ts). Returns the
 * settings as the server now has them.
 */
export async function startFromZero(api: Api, setNewPerDay: () => Promise<void>, deck: string, language: Language): Promise<Settings> {
  let settings = await api.settings();
  // Only a language that counts common words as known has the setting (not Thai).
  const common: CommonCount | null = settings.common?.[language] ?? null;
  const change: Parameters<Api['updateSettings']>[0] = {};
  if (settings.decks[language] !== deck) change.decks = { [language]: deck };
  if (common !== null && common !== 0) change.common = { [language]: 0 };
  if (Object.keys(change).length) settings = await api.updateSettings(change);
  await setNewPerDay();
  await updateFromZero((paths) => startPath(paths, language, deck, common, Date.now()));
  return settings;
}

/**
 * Makes the path's next lesson from the deck's next words not taught yet, and counts it. Throws what the
 * server says (two lessons already being made, Read & Listen off); null when there aren't enough words yet.
 */
export async function makePathLesson(api: Api, path: FromZero, words: readonly DeckWord[]): Promise<number | null> {
  const next = nextLessonWords(path, words);
  if (!next) return null;
  const particle = path.language === 'th' ? await loadParticle() : undefined;
  const id = await api.makeLesson(path.language, lessonScene(path.lessons + 1), undefined, particle, next.map((w) => ({ text: w.word, english: w.meaning })));
  await updateFromZero((paths) => updatePath(paths, path.language, (z) => ({ ...z, lessons: z.lessons + 1, taught: [...z.taught, ...next.map((w) => w.word)] })));
  return id;
}

/** Ends the path once texts can start, putting the language's common-words setting back. */
export async function endFromZero(api: Api, path: FromZero): Promise<Settings | null> {
  const settings = path.common !== null ? await api.updateSettings({ common: { [path.language]: path.common } }) : null;
  await updateFromZero((paths) => endPath(paths, path.language));
  return settings;
}

export const markSoundsSeen = (language: Language): Promise<FromZero[]> => updateFromZero((paths) => updatePath(paths, language, (z) => ({ ...z, soundsSeen: true })));

export const hidePath = (language: Language): Promise<FromZero[]> => updateFromZero((paths) => updatePath(paths, language, (z) => ({ ...z, hidden: true })));
