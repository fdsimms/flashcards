import { grammarPointsFor } from '../core/grammar';
import type { Language } from '../reader/api';
import { LANGUAGE_ORDER } from '../reader/languages';
import { sayFrenchDate } from './french/date';
import { sayFrenchMoney } from './french/money';
import { sayFrenchNumber } from './french/number';
import { sayFrenchTime } from './french/time';
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

export type ToolId = 'mixups' | 'time' | 'dates' | 'money' | 'numbers' | 'counting' | 'script' | 'grammar';

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
 * Each language Reading the script can be read in: Thai's tones, and Russian's and Greek's
 * letters and stress. Japanese is left out, as WaniKani covers reading it.
 */
export const SCRIPTS: Partial<Record<Language, ScriptLanguage>> = {
  th: THAI_SCRIPT,
  el: GREEK_SCRIPT,
  ru: RUSSIAN_SCRIPT,
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
    // Lookalikes and sound-alikes from the learner's own decks (mixups.ts). Every language: a deck with none says so.
    id: 'mixups',
    title: 'Words you mix up',
    summary: 'Tell apart look-alikes and sound-alikes from your decks.',
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
    summary: 'Read a syllable or a word, then hear it.',
    languages: withSayer(SCRIPTS),
  },
  {
    // Spaced drills on the grammar points set to Practice or Know it (docs/grammar.md, step 5).
    id: 'grammar',
    title: 'Grammar',
    summary: "Short drills on the grammar you're practicing, spaced over days.",
    languages: TOOL_LANGUAGES.filter((l) => grammarPointsFor(l).length > 0),
  },
];

export function toolById(id: string | undefined): ToolInfo | undefined {
  return TOOLS.find((t) => t.id === id);
}

/** The language a tool opens in: the one last practiced if the tool has it, else its first. */
export function toolLanguage(tool: ToolInfo, last: Language | undefined): Language {
  return last && tool.languages.includes(last) ? last : tool.languages[0];
}
