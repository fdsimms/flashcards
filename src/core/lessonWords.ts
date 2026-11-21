import type { Language } from '../reader/api';
import { lessonPhraseOf, LESSON_MAX_CHARS, LESSON_MAX_WORDS, noteAddedAt } from './cram';
import { Refusal } from './failure';
import { isDue } from './queue';
import type { Card, Note } from './types';

/**
 * The words an audio lesson is asked to teach (Lessons, Words to teach): chosen from the decks or
 * typed in, sent to the server as the lesson's `phrases` (docs/read-and-listen/architecture.md,
 * Audio lessons). They live only in the draft of the lesson being made. Typing one never makes a
 * note, and nothing here grades a card.
 */
export interface LessonWord {
  text: string;
  english: string;
  /** The note it was chosen from; a typed phrase has none. */
  noteId?: string;
}

/** A word the server thinks a typed phrase could mean (`POST /api/lessons/words`): in the language's own writing, with its reading and its meaning. */
export interface LessonWordCandidate {
  text: string;
  /** Thai's romanization with tone marks, Russian's and Greek's romanization, Japanese's kana; empty where the spelling shows the sound. */
  reading: string;
  english: string;
  /** How common the word is in everyday speech, as Claude judges it (not a frequency list); empty when it wasn't sure. */
  commonness?: string;
  /** How the word is said (`casual`, `neutral`, `formal`, `slang`); empty when Claude wasn't sure. */
  register?: string;
}

/** One small label under a candidate: its words, and how it is drawn (`good` for a word you'll hear daily, `note` for one to be careful with). */
export interface CandidateChip { label: string; tone: 'plain' | 'good' | 'note' }

const COMMONNESS_CHIPS: Record<string, CandidateChip> = {
  very_common: { label: 'Very common', tone: 'good' },
  common: { label: 'Common', tone: 'good' },
  less_common: { label: 'Less common', tone: 'plain' },
  rare: { label: 'Rare', tone: 'note' },
};
const REGISTER_CHIPS: Record<string, CandidateChip> = {
  casual: { label: 'Casual', tone: 'note' },
  formal: { label: 'Formal', tone: 'note' },
  slang: { label: 'Slang', tone: 'note' },
};

/** The chips for a candidate. Neutral speech and anything Claude left blank or the app doesn't know show nothing: a chip says something worth knowing. */
export function candidateChips(c: LessonWordCandidate): CandidateChip[] {
  return [COMMONNESS_CHIPS[c.commonness ?? ''], REGISTER_CHIPS[c.register ?? '']].filter((x): x is CandidateChip => !!x);
}

/**
 * The lesson languages not written in Latin letters (server lesson_words.SCRIPTS). Romanization is how a
 * tutor or a book writes their words down, and the voice would read it as if it were the language's own
 * writing, so every typed word is looked up and the learner picks the one they mean.
 */
export const ROMANIZED_LESSON_LANGUAGES: readonly Language[] = ['th', 'ru', 'el', 'ja'];

/** The line under the add field: what can be typed to find a word. */
export const lessonWordHint = (language: Language, name: string): string =>
  ROMANIZED_LESSON_LANGUAGES.includes(language) ? `Romanization, ${name} or English all work.` : `${name} or English both work.`;

/** The lesson word for the candidate the learner picked: the word as the language writes it, and its meaning. */
export const candidateWord = (c: LessonWordCandidate): LessonWord => ({ text: c.text, english: c.english });

/** What the add screen says when nothing real fits what was typed. */
export const noCandidatesText = (typed: string, name: string): string =>
  `Couldn't find a ${name} word for "${typed.replace(/\s+/g, ' ').trim()}". Try another spelling.`;

/** Which of the language's notes the deck picker lists first. */
export type WordFilter = 'recent' | 'due' | 'lapsed';

export const WORD_FILTERS: { value: WordFilter; label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'due', label: 'Due today' },
  { value: 'lapsed', label: 'Lapsed' },
];

/** How many rows the picker draws at once: a search narrows the list. */
export const PICKER_ROWS = 80;

/** What a phrase is compared by, so the same word typed with other spacing or case isn't added twice. */
export const wordKey = (text: string): string => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The language's notes as lesson words, for the picker: `filter` decides which come first (and for
 * Due today and Lapsed, which are listed at all), and `query` keeps those whose word or meaning
 * contains it. A note is as the lesson would take it (`lessonPhraseOf`), so one that couldn't be
 * sent isn't offered.
 */
export function pickerWords(
  notes: Note[], cards: Card[], language: Language, filter: WordFilter, query: string, now: Date, dayStartsAtHour: number,
): LessonWord[] {
  const live = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.suspended || c.retired) continue;
    live.set(c.noteId, [...(live.get(c.noteId) ?? []), c]);
  }
  const q = wordKey(query);
  const rows: { word: LessonWord; rank: number }[] = [];
  for (const note of notes) {
    const word = lessonPhraseOf(note, language);
    if (!word) continue;
    if (q && !wordKey(word.text).includes(q) && !wordKey(word.english).includes(q)) continue;
    const own = live.get(note.id) ?? [];
    if (filter === 'recent') rows.push({ word, rank: -noteAddedAt(note) });
    else if (filter === 'due') {
      const due = own.filter((c) => isDue(c, now, dayStartsAtHour));
      if (due.length) rows.push({ word, rank: Math.min(...due.map((c) => new Date(c.sched.due).getTime())) });
    } else {
      const lapses = Math.max(0, ...own.map((c) => c.sched.lapses));
      if (lapses > 0) rows.push({ word, rank: -lapses });
    }
  }
  return rows.sort((a, b) => a.rank - b.rank).slice(0, PICKER_ROWS).map((r) => r.word);
}

/**
 * The words with `word` added. Refused, with the reason, when it's blank, too long to send, already
 * there or one word too many, so the screen says so instead of dropping it. A chosen word and a
 * typed one are the same word when they read the same.
 */
export function addLessonWord(words: LessonWord[], word: LessonWord): LessonWord[] {
  const text = word.text.replace(/\s+/g, ' ').trim();
  const english = word.english.replace(/\s+/g, ' ').trim();
  if (!text || !english) throw new Refusal('Enter the word and its meaning.');
  if (text.length > LESSON_MAX_CHARS || english.length > LESSON_MAX_CHARS) {
    throw new Refusal(`A word and its meaning can each be up to ${LESSON_MAX_CHARS} characters. Shorten it and try again.`);
  }
  if (words.some((w) => wordKey(w.text) === wordKey(text))) throw new Refusal("That word is already in this lesson.");
  if (words.length >= LESSON_MAX_WORDS) throw new Refusal(`A lesson teaches at most ${LESSON_MAX_WORDS} words. Remove one to add another.`);
  return [...words, { text, english, ...(word.noteId ? { noteId: word.noteId } : {}) }];
}

/** The words with the one reading as `text` taken out. */
export const removeLessonWord = (words: LessonWord[], text: string): LessonWord[] => words.filter((w) => wordKey(w.text) !== wordKey(text));

/** Whether the words include one reading as `text`. */
export const hasLessonWord = (words: LessonWord[], text: string): boolean => words.some((w) => wordKey(w.text) === wordKey(text));

/** The words as the server's `phrases` take them: the word and its meaning, in the order chosen. */
export const lessonRequestWords = (words: LessonWord[]): { text: string; english: string }[] => words.map(({ text, english }) => ({ text, english }));
