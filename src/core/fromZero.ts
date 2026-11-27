// Starting a language from zero (docs/read-and-listen/architecture.md, From zero): a deck in a language
// Read & Listen has, started empty, gets a path. How the language sounds (src/tools/soundGuides.ts), the
// most common words first (suggested words, from word 1), learned a few new a day, audio lessons made from
// those words 15 at a time, and texts once about `TEXTS_AT` words are studied. Pure, so it's tested; the
// phone keeps the state (src/ui/fromZeroStorage.ts) and Today shows it (FromZeroCard.tsx). Nothing here
// grades a card or writes a note: words reach the deck through Words to add and its approval, as always.
import type { Card, Note } from './types';
import type { CommonCount, Language } from '../reader/api';

/** Words asked for at the start, the most common first. */
export const FIRST_WORDS = 50;
/** A lesson's words. */
export const LESSON_WORDS = 15;
/** Studied words at which texts start, and the path ends. */
export const TEXTS_AT = 150;
/** New cards a day set on the deck when the path starts. */
export const FROM_ZERO_NEW_PER_DAY = 10;

/** The scene of each lesson made on the path, in turn: everyday situations a beginner meets first. */
export const LESSON_SCENES = [
  'Meeting someone for the first time',
  'At a café',
  'Talking about your day',
  'At the shop',
  'Asking the way',
  'At home with family',
  'Making plans with a friend',
  'At a restaurant',
] as const;

/** Lesson `n`'s scene, counting from 1. */
export const lessonScene = (n: number): string => LESSON_SCENES[(Math.max(1, n) - 1) % LESSON_SCENES.length];

export interface FromZero {
  language: Language;
  deck: string;
  /** When it was started, epoch ms. */
  startedAt: number;
  soundsSeen: boolean;
  /** The words lessons were made from so far, in order. */
  taught: string[];
  lessons: number;
  /**
   * The language's common-words setting before the path set it to 0, put back when texts start;
   * null for a language without one (Thai).
   */
  common: CommonCount | null;
  /** Hidden from Today by the owner; the path still ends when texts start. */
  hidden: boolean;
}

/** A word in the deck, in the order it was added (the order it was approved in: most common first). */
export interface DeckWord {
  noteId: string;
  word: string;
  meaning: string;
  studied: boolean;
}

/**
 * The deck's words, oldest first. Notes are approved one at a time in the order they were queued, and
 * a note's id is the time it was added (Anki's), so this is the frequency order the words came in.
 */
export function deckWords(notes: readonly Note[], cards: Iterable<Card>, inDeck: (note: Note) => boolean, wordOf: (note: Note) => string, meaningOf: (note: Note) => string): DeckWord[] {
  const studied = new Set<string>();
  for (const c of cards) if (c.sched.state !== 0) studied.add(c.noteId);
  const order = (n: Note) => (/^\d+$/.test(n.id) ? Number(n.id) : Number.MAX_SAFE_INTEGER);
  return notes
    .filter(inDeck)
    .slice()
    .sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))
    .map((n) => ({ noteId: n.id, word: wordOf(n), meaning: meaningOf(n), studied: studied.has(n.id) }))
    .filter((w) => w.word);
}

export const studiedCount = (words: readonly DeckWord[]): number => words.filter((w) => w.studied).length;

/** Whether texts can start: enough words studied for a text to be mostly words the learner knows. */
export const textsReady = (words: readonly DeckWord[]): boolean => studiedCount(words) >= TEXTS_AT;

/**
 * The next lesson's words: the deck's next `LESSON_WORDS` not taught yet, in order. Null until that many
 * are in the deck, so a lesson is never made from a handful.
 */
export function nextLessonWords(z: Pick<FromZero, 'taught'>, words: readonly DeckWord[]): DeckWord[] | null {
  const taught = new Set(z.taught.map((w) => w.toLocaleLowerCase()));
  const next = words.filter((w) => w.meaning && !taught.has(w.word.toLocaleLowerCase())).slice(0, LESSON_WORDS);
  return next.length === LESSON_WORDS ? next : null;
}

export type StepState = 'done' | 'now' | 'later';

export interface PathStep {
  id: 'sounds' | 'words' | 'study' | 'lesson' | 'texts';
  title: string;
  detail: string;
  state: StepState;
  /** 0 to 1, for a step measured as it goes. */
  progress?: number;
}

/** The path as Today shows it: what's done, what's next, and how far to texts. */
export function pathSteps(z: FromZero, words: readonly DeckWord[], name: string, newPerDay: number): PathStep[] {
  const inDeck = words.length;
  const studied = studiedCount(words);
  const next = nextLessonWords(z, words);
  const lessonNumber = z.lessons + 1;
  return [
    {
      id: 'sounds',
      title: `How ${name} sounds`,
      detail: z.soundsSeen ? 'Read and heard' : 'The sounds that aren\'t read the way English reads them',
      state: z.soundsSeen ? 'done' : 'now',
    },
    {
      id: 'words',
      title: `Your first ${FIRST_WORDS} words`,
      detail: inDeck >= FIRST_WORDS ? 'In your deck, most common first' : inDeck ? `${inDeck} of ${FIRST_WORDS} in your deck` : 'The most common words, checked by you before they\'re added',
      state: inDeck >= FIRST_WORDS ? 'done' : 'now',
      progress: inDeck < FIRST_WORDS ? inDeck / FIRST_WORDS : undefined,
    },
    {
      id: 'study',
      title: `Learn them: ${newPerDay} new a day`,
      detail: inDeck ? `${studied} of ${inDeck} studied` : 'Once your first words are in your deck',
      state: inDeck && studied >= inDeck ? 'done' : inDeck ? 'now' : 'later',
      progress: inDeck ? studied / inDeck : undefined,
    },
    {
      id: 'lesson',
      title: `Lesson ${lessonNumber}`,
      detail: next ? `From your next ${LESSON_WORDS} words` : z.lessons ? `Once ${LESSON_WORDS} more words are in your deck` : `Once ${LESSON_WORDS} words are in your deck`,
      state: next ? 'now' : 'later',
    },
    {
      id: 'texts',
      title: 'Texts to read',
      detail: `Start at ${TEXTS_AT} words you've studied. You've studied ${studied}.`,
      state: studied >= TEXTS_AT ? 'done' : 'later',
      progress: Math.min(1, studied / TEXTS_AT),
    },
  ];
}

/** The paths with `language` started on `deck`, replacing one already there for it. */
export function startPath(list: readonly FromZero[], language: Language, deck: string, common: CommonCount | null, now: number): FromZero[] {
  return [...list.filter((z) => z.language !== language), { language, deck, startedAt: now, soundsSeen: false, taught: [], lessons: 0, common, hidden: false }];
}

/** The paths with `language`'s changed. */
export function updatePath(list: readonly FromZero[], language: Language, change: (z: FromZero) => FromZero): FromZero[] {
  return list.map((z) => (z.language === language ? change(z) : z));
}

/** The paths with `language`'s ended (texts started): its common-words setting is put back by the caller. */
export const endPath = (list: readonly FromZero[], language: Language): FromZero[] => list.filter((z) => z.language !== language);

export function parseFromZero(raw: string | null): FromZero[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((z): z is FromZero => !!z && typeof z.language === 'string' && typeof z.deck === 'string' && typeof z.startedAt === 'number'
      && typeof z.soundsSeen === 'boolean' && Array.isArray(z.taught) && z.taught.every((w: unknown) => typeof w === 'string')
      && typeof z.lessons === 'number' && (z.common === null || typeof z.common === 'number') && typeof z.hidden === 'boolean');
  } catch {
    return [];
  }
}
