import { deckNameLanguage } from '../core/cards';
import { grammarPointsFor } from '../core/grammar';
import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { contrastSetsFor } from './contrasts';
import { sayFrenchDate } from './french/date';
import { sayFrenchMoney } from './french/money';
import { sayFrenchNumber } from './french/number';
import { sayFrenchTime } from './french/time';
import { CASE_LANGUAGES } from './cases';
import { HEARING } from './hearing';
import { SOUND_GUIDES } from './soundGuides';
import { GERMAN_COUNTING } from './german/counting';
import { sayGermanDate } from './german/date';
import { sayGermanMoney } from './german/money';
import { sayGermanNumber } from './german/number';
import { sayGermanTime } from './german/time';
import { GREEK_COUNTING } from './greek/counting';
import { GREEK_SCRIPT } from './greek/script';
import { sayGreekDate } from './greek/date';
import { sayGreekMoney } from './greek/money';
import { sayGreekNumber } from './greek/number';
import { sayGreekTime } from './greek/time';
import { JAPANESE_SCRIPT } from './japanese/script';
import { JAPANESE_COUNTING } from './japanese/counting';
import { sayJapaneseDate } from './japanese/date';
import { sayJapaneseMoney } from './japanese/money';
import { sayJapaneseNumber } from './japanese/number';
import { sayJapaneseTime } from './japanese/time';
import { NORWEGIAN_COUNTING } from './norwegian/counting';
import { sayNorwegianDate } from './norwegian/date';
import { sayNorwegianMoney } from './norwegian/money';
import { sayNorwegianNumber } from './norwegian/number';
import { sayNorwegianTime } from './norwegian/time';
import { POLISH_COUNTING } from './polish/counting';
import { sayPolishDate } from './polish/date';
import { sayPolishMoney } from './polish/money';
import { sayPolishNumber } from './polish/number';
import { sayPolishTime } from './polish/time';
import { RUSSIAN_COUNTING } from './russian/counting';
import { RUSSIAN_SCRIPT } from './russian/script';
import { sayRussianDate } from './russian/date';
import { sayRussianMoney } from './russian/money';
import { sayRussianNumber } from './russian/number';
import { sayRussianTime } from './russian/time';
import { saySpanishDate } from './spanish/date';
import { saySpanishMoney } from './spanish/money';
import { saySpanishNumber } from './spanish/number';
import { saySpanishTime } from './spanish/time';
import { THAI_COUNTING } from './thai/counting';
import { THAI_SCRIPT } from './thai/script';
import { sayThaiDate } from './thai/date';
import { sayThaiMoney } from './thai/money';
import { sayThaiNumber } from './thai/number';
import { sayThaiTime } from './thai/time';
import type { CalendarDate, DateParts, DateSaying } from './date';
import type { CountingLanguage } from './counting';
import type { CurrencyCode, MoneySaying } from './money';
import type { ScriptLanguage } from './script';
import type { NumberQuestion, NumberSaying } from './number';
import type { ClockTime, TimeSaying } from './time';
import type { WritingLanguage } from './writing';
import { GREEK_WRITING } from './greek/writing';
import { JAPANESE_WRITING } from './japanese/writing';
import { RUSSIAN_WRITING } from './russian/writing';
import { THAI_WRITING } from './thai/writing';

/**
 * Practice tools: small drills outside the decks, listed on the Practice tab, each a screen of its
 * own. A new tool is an entry in `TOOLS`, its logic beside this file (each language's under that
 * language's folder, e.g. thai/), and its screen and icon in `TOOL_SCREENS` (src/ui/tools/), which
 * won't typecheck until it has one. A tool comes in every one of the app's languages
 * (`TOOL_LANGUAGES`, Read & Listen's but English) unless it doesn't apply to one. Nothing here touches the
 * collection: a tool never grades a card or writes a review.
 */

/** The languages the tools come in: every app language but English, which the app is already in. */
export const TOOL_LANGUAGES: Language[] = LANGUAGE_ORDER.filter((l) => l !== 'en');

export type ToolId = 'mixups' | 'sounds' | 'hearing' | 'contrast' | 'journal' | 'sentences' | 'situations' | 'time' | 'dates' | 'money' | 'numbers' | 'counting' | 'script' | 'writing' | 'grammar' | 'cases';

export interface ToolInfo {
  id: ToolId;
  title: string;
  /** One line under the title in the list. */
  summary: string;
  /** The languages it can be practiced in, in the app's order. */
  languages: Language[];
}

/** Each language Telling the time can say a time in. */
export const TIME_SAYERS: Partial<Record<Language, (t: ClockTime) => TimeSaying>> = {
  th: sayThaiTime,
  es: saySpanishTime,
  fr: sayFrenchTime,
  de: sayGermanTime,
  el: sayGreekTime,
  ja: sayJapaneseTime,
  nb: sayNorwegianTime,
  pl: sayPolishTime,
  ru: sayRussianTime,
};

/** Each language Saying dates can say a date in. */
export const DATE_SAYERS: Partial<Record<Language, (d: CalendarDate, parts: DateParts) => DateSaying>> = {
  th: sayThaiDate,
  es: saySpanishDate,
  fr: sayFrenchDate,
  de: sayGermanDate,
  el: sayGreekDate,
  ja: sayJapaneseDate,
  nb: sayNorwegianDate,
  pl: sayPolishDate,
  ru: sayRussianDate,
};

/** Each language Counting money can say an amount in, in its currency (`CURRENCY_OF`). */
export const MONEY_SAYERS: Partial<Record<Language, (amount: number) => MoneySaying>> = {
  th: sayThaiMoney,
  es: saySpanishMoney,
  fr: sayFrenchMoney,
  de: sayGermanMoney,
  el: sayGreekMoney,
  ja: sayJapaneseMoney,
  nb: sayNorwegianMoney,
  pl: sayPolishMoney,
  ru: sayRussianMoney,
};

/** Each language Numbers can say a number in (a plain number, a phone number, a year, an age). */
export const NUMBER_SAYERS: Partial<Record<Language, (q: NumberQuestion) => NumberSaying>> = {
  th: sayThaiNumber,
  es: saySpanishNumber,
  fr: sayFrenchNumber,
  de: sayGermanNumber,
  el: sayGreekNumber,
  ja: sayJapaneseNumber,
  nb: sayNorwegianNumber,
  pl: sayPolishNumber,
  ru: sayRussianNumber,
};

/**
 * Each language Counting things can count in. Spanish and French are left out: their plurals are
 * regular, and the one thing a number changes (veintiuna, vingt et une) is already in Numbers.
 */
export const COUNTING: Partial<Record<Language, CountingLanguage>> = {
  th: THAI_COUNTING,
  de: GERMAN_COUNTING,
  el: GREEK_COUNTING,
  ja: JAPANESE_COUNTING,
  nb: NORWEGIAN_COUNTING,
  pl: POLISH_COUNTING,
  ru: RUSSIAN_COUNTING,
};

/**
 * Each language Reading the script can be read in: Thai's tones, Russian's and Greek's letters and
 * stress, and Japanese's kana (small っ and ゃ, long vowels, katakana's ー). Kanji are left to WaniKani.
 */
export const SCRIPTS: Partial<Record<Language, ScriptLanguage>> = {
  th: THAI_SCRIPT,
  el: GREEK_SCRIPT,
  ja: JAPANESE_SCRIPT,
  ru: RUSSIAN_SCRIPT,
};

/**
 * Each language Writing by hand can be written in: the ones with a script of their own to learn.
 * Japanese's kanji come from WaniKani once its token is entered (src/wanikani/writingKanji.ts).
 */
export const WRITING: Partial<Record<Language, WritingLanguage>> = {
  th: THAI_WRITING,
  el: GREEK_WRITING,
  ja: JAPANESE_WRITING,
  ru: RUSSIAN_WRITING,
};

/** The money each language is practiced with: Mexican pesos for Spanish, as its voice is Mexican. */
export const CURRENCY_OF: Partial<Record<Language, CurrencyCode>> = {
  th: 'THB', es: 'MXN', fr: 'EUR', de: 'EUR', el: 'EUR', pl: 'PLN', ru: 'RUB', nb: 'NOK', ja: 'JPY',
};

/** The weekday a calendar's week starts on where the language is spoken: 0 Sunday (Thailand, Mexico, Japan), 1 Monday. */
export const WEEK_STARTS_ON: Partial<Record<Language, 0 | 1>> = {
  th: 0, es: 0, fr: 1, de: 1, el: 1, pl: 1, ru: 1, nb: 1, ja: 0,
};

const withSayer = (sayers: Partial<Record<Language, unknown>>) => TOOL_LANGUAGES.filter((l) => !!sayers[l]);

export const TOOLS: ToolInfo[] = [
  {
    // Lookalikes, sound-alikes and linked pairs from the learner's own decks (mixups.ts). Every language: a deck with none says so.
    id: 'mixups',
    title: 'Similar words',
    summary: 'Tell apart look-alikes, sound-alikes and words you link as mixed up.',
    languages: TOOL_LANGUAGES,
  },
  {
    // The letters and sounds that aren't read the way English reads them, each with a word to hear
    // (soundGuides.ts). Also the first step of a language started from zero (src/core/fromZero.ts).
    id: 'sounds',
    title: 'How it sounds',
    summary: "The letters that aren't read the way English reads them, with words to hear.",
    languages: TOOL_LANGUAGES.filter((l) => !!SOUND_GUIDES[l]),
  },
  {
    // Hand-written sets of words differing by one sound (hearing.ts), each played in several voices:
    // which was it? Azure's voices through Read & Listen's server, else the phone's one voice.
    id: 'hearing',
    title: 'Hearing sounds',
    summary: 'Hear a word in different voices and pick which one it was.',
    languages: withSayer(HEARING),
  },
  {
    // Hand-written sentences that only one word of a set fits (contrasts.ts): จน or จนกว่า. Also skill cards in Review.
    id: 'contrast',
    title: 'Which word fits',
    summary: 'Pick the word that fits a sentence, from words easily mixed up.',
    languages: TOOL_LANGUAGES.filter((l) => contrastSetsFor(l).length > 0),
  },
  {
    // Anything written in the language, checked by Claude sentence by sentence and kept (server/reader
    // journal.py, src/reader/journal.ts). Needs Read & Listen; an entry written offline is held until it answers.
    id: 'journal',
    title: 'Journal',
    summary: 'Write anything in the language. Claude checks it.',
    languages: TOOL_LANGUAGES,
  },
  {
    // English sentences around words reviewed today or young, to say in the language (server/reader
    // sentences.py). Needs Read & Listen's server; the Practice list says so while it's off.
    id: 'sentences',
    title: 'Sentences',
    summary: "Say a sentence with a word you've just reviewed, then compare.",
    languages: TOOL_LANGUAGES,
  },
  {
    // A scene talked through with Claude playing the other person (server/reader situations.py). Needs
    // Read & Listen's server, like Sentences.
    id: 'situations',
    title: 'Situations',
    summary: 'Talk your way through a scene. Claude plays the other person.',
    languages: TOOL_LANGUAGES,
  },
  {
    id: 'time',
    title: 'Telling the time',
    summary: 'Say a time out loud, then check it.',
    languages: withSayer(TIME_SAYERS),
  },
  {
    id: 'dates',
    title: 'Saying dates',
    summary: 'Say a date out loud, then check it.',
    languages: withSayer(DATE_SAYERS),
  },
  {
    id: 'money',
    title: 'Counting money',
    summary: 'Count notes and coins, or read a price.',
    languages: withSayer(MONEY_SAYERS),
  },
  {
    id: 'numbers',
    title: 'Numbers',
    summary: 'Phone numbers, years and ages, said or heard.',
    languages: withSayer(NUMBER_SAYERS),
  },
  {
    id: 'counting',
    title: 'Counting things',
    summary: 'A number with a noun: counters, classifiers and endings.',
    languages: withSayer(COUNTING),
  },
  {
    id: 'script',
    title: 'Reading the script',
    summary: 'Read a syllable, word or letter, then hear it.',
    languages: withSayer(SCRIPTS),
  },
  {
    // A letter, a word or a kanji written with a finger, then compared with the real one (writing.ts, ink.ts).
    id: 'writing',
    title: 'Writing by hand',
    summary: 'Write a letter or word with your finger, then compare.',
    languages: withSayer(WRITING),
  },
  {
    // The grammar points in a language: read about one, and practice it (docs/grammar.md, steps 4 and 5).
    id: 'grammar',
    title: 'Grammar',
    summary: "Read about a grammar point, then practice it.",
    languages: TOOL_LANGUAGES.filter((l) => grammarPointsFor(l).length > 0),
  },
  {
    // The case after a preposition or verb, then a studied noun in it (cases.ts). Only languages with cases.
    id: 'cases',
    title: 'Which case',
    summary: 'Name the case after a preposition or verb, then put a noun in it.',
    languages: withSayer(CASE_LANGUAGES),
  },
];

export function toolById(id: string | undefined): ToolInfo | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** The language a tool opens in: the one last practiced if the tool has it, else its first. */
export function toolLanguage(tool: ToolInfo, last: Language | undefined): Language {
  return last && tool.languages.includes(last) ? last : tool.languages[0];
}

/**
 * The language the Practice list shows: the one last practiced if tools come in it, else the one
 * with the most cards of those studied (`studiedLanguages`), else the first.
 */
export function listLanguage(last: Language | undefined, studied: Language[]): Language {
  if (last && TOOL_LANGUAGES.includes(last)) return last;
  return studied.find((l) => TOOL_LANGUAGES.includes(l)) ?? TOOL_LANGUAGES[0];
}

/**
 * The tool languages the decks are in, the one with the most cards first: read from each top-level
 * deck's name and its subdecks' (`deckNameLanguage`), as a card's language is. The language menu
 * lists these first, and a first visit opens in the first.
 */
export function studiedLanguages(decks: { deck: string; depth: number; total: number }[]): Language[] {
  const cards = new Map<Language, number>();
  for (const d of decks) {
    const code = deckNameLanguage(d.deck)?.split('-')[0].toLowerCase();
    const lang = (code === 'no' ? 'nb' : code) as Language | undefined;
    if (!lang || !TOOL_LANGUAGES.includes(lang)) continue;
    // A deck's total includes its subdecks', so only the highest deck in a language counts.
    const parent = d.deck.split('::').slice(0, -1).join('::');
    if (parent && decks.some((p) => p.deck === parent && deckNameLanguage(p.deck) === deckNameLanguage(d.deck))) continue;
    cards.set(lang, (cards.get(lang) ?? 0) + d.total);
  }
  return [...cards].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || TOOL_LANGUAGES.indexOf(a[0]) - TOOL_LANGUAGES.indexOf(b[0])).map(([l]) => l);
}
