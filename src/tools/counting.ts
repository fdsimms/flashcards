import type { Phrase } from './phrase';
import { pickOther } from './random';

/**
 * Counting things: a number with a noun, as each language says it. What's hard differs by
 * language, and each language's own counting.ts holds its nouns and how it counts them:
 *
 * - Thai and Japanese count with a classifier or counter chosen by the kind of thing (แมวสามตัว,
 *   鉛筆が三本), and a Japanese counter can change the number's sound (いっぽん, さんぼん).
 * - Polish and Russian put the noun in a case set by the number's last digits (dwa koty, pięć
 *   kotów; два кота, пять котов), and 1 and 2 agree with its gender (dwie książki, одна книга).
 * - Greek's 1, 3 and 4 agree with the noun's gender (τρεις γάτες, τρία βιβλία), with the plural.
 * - German and Norwegian plurals have to be known (drei Hunde, tre bøker).
 * - Spanish and French 1 agrees with the noun's gender, in 21 and 31 too (veintiuna casas, vingt et
 *   une tables).
 *
 * Pure; nothing is scheduled or saved (tests/tools/noGrading.test.ts).
 */

/** A noun to count, as the question card shows it. */
export interface CountNoun {
  /** In the language, with what tells its gender where that matters (der Hund, el perro, ο σκύλος). */
  cue: Phrase;
  /** In English, under it. */
  meaning: string;
}

/** A number with a noun, said in one language. */
export interface CountSaying {
  everyday: Phrase;
  also: Phrase[];
}

/** One language's counting: its nouns, and how it says, offers, explains and tallies a count. */
export interface CountingLanguage {
  nouns: CountNoun[];
  say: (noun: number, n: number) => CountSaying;
  /**
   * Wrong answers that look right, for Pick: a wrong classifier, case, form or plural. At least
   * two that differ from the answer; Pick shows up to three of them.
   */
  wrong: (noun: number, n: number) => Phrase[];
  /** The rule behind the answer, shown after a miss, where there's a short, certain one. */
  rule: (noun: number, n: number) => string | undefined;
  /** The patterns a miss leans toward (marks.ts): the counter, the case, the noun. */
  patterns: (noun: number, n: number) => string[];
  /**
   * Pick shows each choice by its reading (Japanese: the kana), where the reading is what's
   * being asked: 三本 is the same in kanji whether it's read さんぼん or さんほん.
   */
  pickByReading?: boolean;
}

export interface CountQuestion {
  /** Its index in the language's `nouns`. */
  noun: number;
  n: number;
}

/** How high the number goes. */
export type CountMax = 10 | 100;
export const COUNT_MAXES: CountMax[] = [10, 100];

/** Say it aloud and show the answer, or pick it from four. */
export const COUNT_MODES = ['say', 'pick'] as const;
export type CountMode = (typeof COUNT_MODES)[number];

export function countKey(q: CountQuestion): string {
  return `${q.noun}:${q.n}`;
}

/** A noun of `nounCount` and a number from 1 to `max` at random, never `previous` again. */
export function randomCount(nounCount: number, max: CountMax, previous?: CountQuestion, random: () => number = Math.random): CountQuestion {
  const total = nounCount * max;
  const last = previous && previous.noun < nounCount && previous.n >= 1 && previous.n <= max ? previous.noun * max + previous.n - 1 : undefined;
  const i = pickOther(total, last, random);
  return { noun: Math.floor(i / max), n: (i % max) + 1 };
}

/** What Pick shows of a choice: its reading, where that's what's asked (`byReading`), else its text. */
export function choiceText(p: Phrase, byReading = false): string {
  return byReading && p.roman ? p.roman : p.text;
}

/**
 * Pick's four choices: the answer and three of `wrong` (none shown the same as it, or as each
 * other: `shown` is what's shown of each), in an order from `random`. `correct` is where the
 * answer landed.
 */
export function countChoices(answer: Phrase, wrong: Phrase[], random: () => number = Math.random, shown: (p: Phrase) => string = (p) => p.text): { choices: Phrase[]; correct: number } {
  const seen = new Set([shown(answer)]);
  const others = wrong.filter((p) => !seen.has(shown(p)) && !!seen.add(shown(p)));
  // Three of them, at random.
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const choices = others.slice(0, 3);
  const correct = Math.floor(random() * (choices.length + 1));
  choices.splice(correct, 0, answer);
  return { choices, correct };
}

/** The last two digits' kind, as most languages' counting turns on: teen, 1, 2 to 4, or the rest. */
export function countEnding(n: number): 'teen' | '1' | '2-4' | 'many' {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return 'teen';
  const last = n % 10;
  return last === 1 ? '1' : last >= 2 && last <= 4 ? '2-4' : 'many';
}
