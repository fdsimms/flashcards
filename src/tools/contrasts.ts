import type { Language } from '../reader/api';
import { THAI_CONTRASTS } from './thai/contrasts';

/**
 * Which word fits: sets of words easily mixed up (จน and จนกว่า, รู้ and รู้จัก), each with
 * hand-written sentences that only one of them fits. A sentence is shown with a gap, the set's words
 * are the choices, and the answer shows the sentence filled in with the rule for the word that fits.
 * Asked in two places: a skill card per set in Review (src/tools/skills.ts, the `contrast` drill
 * group), which waits until the deck knows the set's words, and the Practice tab's Which word fits
 * (src/ui/tools/ContrastTool.tsx), which offers a set once its words are studied. Like every tool it
 * never grades a card: in Review the learner's tap on a rating does. Pure.
 *
 * The sets are written by hand per language (thai/contrasts.ts), so a sentence can be checked by a
 * person before it ships; tests/tools/contrasts.test.ts holds the rules each sentence must keep.
 */

/** The gap in a sentence's tokens. */
export const GAP = '_';
/** A space as the language writes it between clauses (Thai has no spaces between words, only between phrases). */
export const SPACE = '/';
/** What the gap shows as on the card. */
export const GAP_SHOWN = '＿＿＿';

export interface ContrastWord {
  /** As the deck writes it (its Entry). */
  word: string;
  /** Romanized, for a language not written in Latin letters. */
  roman?: string;
  /** When this word is the one: a line in plain English, shown once a sentence it fits is answered. */
  rule: string;
}

export interface ContrastSentence {
  /** The sentence's words in order, `GAP` where the answer goes and `SPACE` where the language puts a space. */
  tokens: readonly string[];
  /** Which of the set's words fits the gap. */
  answer: number;
  english: string;
  /** The whole sentence romanized, the answer in place, for a language not written in Latin letters. */
  roman?: string;
}

export interface ContrastSet {
  /** Stable across versions: it's written into the skill card's tags (`skill::drill::contrast-<id>`). Starts with the language code. */
  id: string;
  words: readonly ContrastWord[];
  sentences: readonly ContrastSentence[];
}

/** How a set's skill step id starts (`contrast-th-jon`), in src/tools/skills.ts. */
export const CONTRAST_STEP_PREFIX = 'contrast-';

/** Each language's sets. A language with none has no Which word fits. */
export const CONTRAST_SETS: Partial<Record<Language, readonly ContrastSet[]>> = { th: THAI_CONTRASTS };

export const contrastSetsFor = (language: Language): readonly ContrastSet[] => CONTRAST_SETS[language] ?? [];

/** A set by its id, and its language. */
export function contrastSet(id: string): { set: ContrastSet; language: Language } | undefined {
  for (const [language, sets] of Object.entries(CONTRAST_SETS) as [Language, readonly ContrastSet[]][]) {
    const set = sets.find((s) => s.id === id);
    if (set) return { set, language };
  }
  return undefined;
}

/** A set's name: its words, "จน / จนกว่า". */
export const contrastTitle = (set: ContrastSet): string => set.words.map((w) => w.word).join(' / ');

/** Languages written without spaces between words, whose tokens are joined with nothing. */
const UNSPACED: readonly Language[] = ['th', 'ja'];

/** A sentence as it is shown: the text either side of the gap, the whole of it filled in, and its romanization and English. */
export interface ShownSentence {
  before: string;
  after: string;
  /** The word that fits. */
  answer: ContrastWord;
  /** The sentence with the answer in the gap. */
  filled: string;
  roman?: string;
  english: string;
}

export function showSentence(set: ContrastSet, index: number, language: Language): ShownSentence | undefined {
  const s = set.sentences[index];
  if (!s) return undefined;
  const glue = UNSPACED.includes(language) ? '' : ' ';
  const join = (tokens: readonly string[]) => tokens.reduce((out, t) => (t === SPACE ? `${out} ` : out && !out.endsWith(' ') ? `${out}${glue}${t}` : `${out}${t}`), '');
  const at = s.tokens.indexOf(GAP);
  const answer = set.words[s.answer];
  const before = join(s.tokens.slice(0, at));
  const after = join(s.tokens.slice(at + 1));
  // The gap joins its neighbours as a word would: with the language's glue, or the space a SPACE token gave.
  const filled = join(s.tokens.map((t) => (t === GAP ? answer.word : t)));
  const sep = (side: string, end: 'start' | 'end') => (!side ? '' : end === 'end' ? (side.endsWith(' ') ? '' : glue) : (side.startsWith(' ') ? '' : glue));
  return { before: before + sep(before, 'end'), after: sep(after, 'start') + after, answer, filled, roman: s.roman, english: s.english };
}

/** A sentence of a set, as a Practice question or a drill's. */
export interface ContrastQuestion { setId: string; index: number }

/** A question's key, so the same one isn't asked twice in a row (and for drillSeen's recent list). */
export const contrastKey = (q: ContrastQuestion): string => `${q.setId}:${q.index}`;

/** A word as compared with a deck's headwords. */
const norm = (w: string) => w.normalize('NFC').toLocaleLowerCase().trim();

/** The words of `set` that `headwords` lack. */
export function missingWords(set: ContrastSet, headwords: Iterable<string>): string[] {
  const have = new Set([...headwords].map(norm));
  return set.words.map((w) => w.word).filter((w) => !have.has(norm(w)));
}

/** The sets whose every word is among `headwords` (the words studied): the only ones worth asking, since telling apart a word not yet learned tests nothing. */
export function setsKnown(sets: readonly ContrastSet[], headwords: Iterable<string>): ContrastSet[] {
  const have = [...headwords];
  return sets.filter((s) => missingWords(s, have).length === 0);
}

/**
 * The next question from `sets` (only the one with id `only`, when given): a sentence not among the
 * `recent` keys while the sets have others, never the last one asked. Undefined when there are no sentences.
 */
export function nextContrast(sets: readonly ContrastSet[], only: string | undefined, recent: readonly string[], random: () => number = Math.random): ContrastQuestion | undefined {
  const all = sets.filter((s) => !only || s.id === only).flatMap((s) => s.sentences.map((_, index) => ({ setId: s.id, index })));
  if (!all.length) return undefined;
  const last = recent[recent.length - 1];
  // The recent ones held back, keeping at least one question to ask; the very last is held back whenever there's another.
  const window = new Set(recent.slice(-Math.max(0, all.length - 1)));
  const fresh = all.filter((q) => !window.has(contrastKey(q)));
  const pool = fresh.length ? fresh : all.filter((q) => all.length === 1 || contrastKey(q) !== last);
  return pool[Math.floor(random() * pool.length)];
}

/** A random sentence of `set` other than `previous` (an index) where it has another. */
export function drawSentence(set: ContrastSet, previous: number | undefined, random: () => number = Math.random): number {
  const n = set.sentences.length;
  if (n <= 1 || previous === undefined || previous < 0 || previous >= n) return Math.floor(random() * n);
  const i = Math.floor(random() * (n - 1));
  return i >= previous ? i + 1 : i;
}
