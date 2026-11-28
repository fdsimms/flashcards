import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { SKILL_WORDS_TAG } from '../core/priority';
import { CONTRAST_STEP_PREFIX, contrastSet } from './contrasts';
import { knownAmong } from './knownWords';

/**
 * The words a skill's drills are said in, which a learner can't answer without: the months and the days
 * for Saying dates, the number words (one to ten, the teens, the tens, the hundreds) for Numbers, "half" and
 * the hour for telling the time, the currency for Counting money. Each language's are listed in `WORD_SETS`,
 * from what its drills say (tests/tools/skillWords.test.ts checks every word is said by the step that waits for it). A skill is worthless on words the learner doesn't know, so turning it on adds the ones
 * the deck lacks as ordinary notes (`wordDrafts`), tagged `skill::words` so Review brings some of them up
 * each day (`SKILL_WORDS_PERCENT`, src/core/priority.ts), and a drill step waits until the deck knows them
 * (`stepNeeds`): a word counts once its card has settled (`isSettled`, src/core/progress.ts), not when it
 * has only been seen. A dates drill also asks only about the months (`knownMonths`) and days (`knownDays`)
 * known. Nothing here rates, schedules or writes a card.
 */

/** The note type the words are written in: the one the deck's own words are. */
export const SKILL_WORD_NOTE_TYPE = 'Omnilanguage';

/** How many months must be known before the first dates step opens: it then asks only about the months known. */
export const MIN_MONTHS = 3;

/** How many day ordinals (the first to the tenth, in any order) must be known before the first dates step opens: it then asks only about the days known. */
export const MIN_ORDINALS = 10;

export interface SkillWord { entry: string; meaning: string; /** Omnilanguage's PartOfSpeech; a noun unless said. */ pos?: string }

/** A set of words some drill steps wait for: how many must be studied, and the words in each language. */
export interface WordSet {
  /** What to call the set when saying what's missing ("3 more month names"). */
  label: string;
  /** How many of the words must be studied, or all of them. */
  min: number | 'all';
  /** The drill steps that wait for it. */
  steps: readonly string[];
  /** More steps, for a language whose drills say these words in a step the others don't (a year says "hundred" in Thai, not in Spanish). */
  extraSteps?: Partial<Record<Language, readonly string[]>>;
  words: Partial<Record<Language, readonly SkillWord[]>>;
}

const zip = (entries: readonly string[], meanings: readonly string[], pos?: string): SkillWord[] => entries.map((entry, i) => ({ entry, meaning: meanings[i], pos }));
const one = (entry: string, meaning: string, pos?: string): SkillWord[] => [{ entry, meaning, pos }];

export const MONTH_MEANINGS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const WEEKDAY_MEANINGS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const ORDINAL_MEANINGS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'thirtieth'] as const;
const TEEN_MEANINGS = ['eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'] as const;
const TENS_MEANINGS = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;
const DIGIT_MEANINGS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;

/** The month names in each language, January first, as a dictionary lists them. */
export const MONTH_WORDS: Partial<Record<Language, readonly string[]>> = {
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  el: ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'],
  ja: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
  nb: ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'],
  pl: ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'],
  ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
};

/** The weekday names in each language, Sunday first (the order of `weekdayOf`). */
export const WEEKDAY_WORDS: Partial<Record<Language, readonly string[]>> = {
  th: ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'],
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  el: ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'],
  ja: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
  nb: ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'],
  pl: ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'],
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
};

/** The numbers one to ten in each language. */
export const DIGIT_WORDS: Partial<Record<Language, readonly string[]>> = {
  th: ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ'],
  es: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'],
  fr: ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'],
  de: ['eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'],
  el: ['ένα', 'δύο', 'τρία', 'τέσσερα', 'πέντε', 'έξι', 'εφτά', 'οχτώ', 'εννιά', 'δέκα'],
  ja: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'],
  nb: ['en', 'to', 'tre', 'fire', 'fem', 'seks', 'sju', 'åtte', 'ni', 'ti'],
  pl: ['jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć'],
  ru: ['один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять'],
};

/**
 * The day ordinals (first to nineteenth, then twentieth and thirtieth where a language has them), which a date
 * says the day with in Norwegian, German, Polish and Russian: the rest are built from these and the tens
 * (tjueførste, trettiførste). The other languages say a day as a cardinal (`DAY_PIECES`).
 */
export const ORDINAL_DAY_WORDS: Partial<Record<Language, readonly string[]>> = {
  nb: ['første', 'andre', 'tredje', 'fjerde', 'femte', 'sjette', 'sjuende', 'åttende', 'niende', 'tiende', 'ellevte', 'tolvte', 'trettende', 'fjortende', 'femtende', 'sekstende', 'syttende', 'attende', 'nittende', 'tjuende', 'trettiende'],
  de: ['erste', 'zweite', 'dritte', 'vierte', 'fünfte', 'sechste', 'siebte', 'achte', 'neunte', 'zehnte', 'elfte', 'zwölfte', 'dreizehnte', 'vierzehnte', 'fünfzehnte', 'sechzehnte', 'siebzehnte', 'achtzehnte', 'neunzehnte'],
  pl: ['pierwszy', 'drugi', 'trzeci', 'czwarty', 'piąty', 'szósty', 'siódmy', 'ósmy', 'dziewiąty', 'dziesiąty', 'jedenasty', 'dwunasty', 'trzynasty', 'czternasty', 'piętnasty', 'szesnasty', 'siedemnasty', 'osiemnasty', 'dziewiętnasty', 'dwudziesty', 'trzydziesty'],
  ru: ['первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый', 'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый', 'семнадцатый', 'восемнадцатый', 'девятнадцатый', 'двадцатый', 'тридцатый'],
};
/** Eleven to nineteen, and the tens twenty to ninety: what 11 to 99, a time and a price are said with. French's teens stop at sixteen (`FR_TEENS`). */
export const TEEN_WORDS: Partial<Record<Language, readonly string[]>> = {
  nb: ['elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten', 'atten', 'nitten'],
  de: ['elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'],
  es: ['once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve'],
  el: ['έντεκα', 'δώδεκα', 'δεκατρία', 'δεκατέσσερα', 'δεκαπέντε', 'δεκαέξι', 'δεκαεφτά', 'δεκαοχτώ', 'δεκαεννιά'],
  pl: ['jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'],
  ru: ['одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
};
const FR_TEENS = ['onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'] as const;
export const TENS_WORDS: Partial<Record<Language, readonly string[]>> = {
  nb: ['tjue', 'tretti', 'førti', 'femti', 'seksti', 'sytti', 'åtti', 'nitti'],
  de: ['zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'],
  es: ['veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'],
  fr: ['vingt', 'trente', 'quarante', 'cinquante', 'soixante'],
  el: ['είκοσι', 'τριάντα', 'σαράντα', 'πενήντα', 'εξήντα', 'εβδομήντα', 'ογδόντα', 'ενενήντα'],
  pl: ['dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'],
  ru: ['двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
};

const VEINTI_WORDS = ['veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'] as const;
const VEINTI_MEANINGS = ['twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five', 'twenty-six', 'twenty-seven', 'twenty-eight', 'twenty-nine'] as const;
/** Japanese says the days 1 to 10, 14, 20 and 24 with readings of their own (ふつか, はつか), written as the numeral and 日. */
const JA_SPECIAL_DAYS = ['一日', '二日', '三日', '四日', '五日', '六日', '七日', '八日', '九日', '十日', '十四日', '二十日', '二十四日'] as const;
const JA_SPECIAL_DAY_MEANINGS = ['first of the month', 'second of the month', 'third of the month', 'fourth of the month', 'fifth of the month', 'sixth of the month', 'seventh of the month', 'eighth of the month', 'ninth of the month', 'tenth of the month', 'fourteenth of the month', 'twentieth of the month', 'twenty-fourth of the month'] as const;

/** The words for a hundred and a thousand, which the hundreds and thousands steps can't be said without. */
const HUNDRED: Partial<Record<Language, string>> = { th: 'ร้อย', pl: 'sto', ru: 'сто', de: 'hundert', es: 'cien', fr: 'cent', el: 'εκατό', nb: 'hundre', ja: '百' };
const THOUSAND: Partial<Record<Language, string>> = { th: 'พัน', pl: 'tysiąc', ru: 'тысяча', de: 'tausend', es: 'mil', fr: 'mille', el: 'χίλια', nb: 'tusen', ja: '千' };
/** "Half" for the half-past step (Polish says "wpół do", so the word is wpół), and "quarter" for the quarter-past step (Thai and Japanese say the minutes instead). */
const HALF: Partial<Record<Language, string>> = { th: 'ครึ่ง', es: 'media', fr: 'demi', de: 'halb', el: 'μισή', ja: '半', nb: 'halv', pl: 'wpół', ru: 'половина' };
/** The word the hour is said with, which Thai (เก้าโมง) and German (drei Uhr) can't tell the time without. */
const OCLOCK: Partial<Record<Language, string>> = { th: 'โมง', de: 'Uhr' };
/** Each language's "half" is not the same part of speech: wpół is an adverb, половина and ครึ่ง are nouns, the rest agree with what they modify. */
const HALF_POS: Partial<Record<Language, string>> = { th: 'noun', es: 'adjective', fr: 'adjective', de: 'adjective', el: 'adjective', ja: 'noun', nb: 'adjective', pl: 'adverb', ru: 'noun' };
const QUARTER: Partial<Record<Language, string>> = { es: 'cuarto', fr: 'quart', de: 'Viertel', el: 'τέταρτο', nb: 'kvart', pl: 'kwadrans', ru: 'четверть' };
/** The currency each language's Counting money drills are in (`CURRENCY_OF`), by the name it's said with. */
const CURRENCY: Partial<Record<Language, [string, string]>> = {
  th: ['บาท', 'Thai baht'], es: ['peso', 'Mexican peso'], fr: ['euro', 'euro'], de: ['Euro', 'euro'], el: ['ευρώ', 'euro'],
  ja: ['円', 'yen'], nb: ['krone', 'Norwegian krone'], pl: ['złoty', 'Polish zloty'], ru: ['рубль', 'Russian ruble'],
};

const single = (table: Partial<Record<Language, string>>, meaning: string, pos?: string): WordSet['words'] =>
  Object.fromEntries(Object.entries(table).map(([l, entry]) => [l, one(entry, meaning, pos)]));

const bySet = (table: Partial<Record<Language, readonly string[]>>, meanings: readonly string[], pos?: string): WordSet['words'] =>
  Object.fromEntries(Object.entries(table).map(([l, entries]) => [l, zip(entries, meanings, pos)])) as WordSet['words'];

/** Numerals from a language's table, with the meanings by position. */
const numerals = (entries: readonly string[] | undefined, meanings: readonly string[]): SkillWord[] => zip(entries ?? [], meanings, 'numeral');

/** Where eleven to nineteen and the tens first appear: 11 to 99, a time to the minute, a price and a year. */
const TEEN_STEPS = ['numbers-99', 'time-any', 'money-100', 'dates-year'] as const;
const TENS_STEPS = ['numbers-99', 'money-100', 'dates-year'] as const;
const ALL: readonly Language[] = ['th', 'es', 'fr', 'de', 'el', 'ja', 'nb', 'pl', 'ru'];
const onSteps = (languages: readonly Language[], steps: readonly string[]): NonNullable<WordSet['extraSteps']> => Object.fromEntries(languages.map((l) => [l, steps]));

export const WORD_SETS: readonly WordSet[] = [
  { label: 'month names', min: MIN_MONTHS, steps: ['dates-day', 'dates-weekday', 'dates-year'], words: bySet(MONTH_WORDS, MONTH_MEANINGS) },
  { label: 'weekday names', min: 'all', steps: ['dates-weekday', 'dates-year'], words: bySet(WEEKDAY_WORDS, WEEKDAY_MEANINGS) },
  // One to ten are said in every step that says a number, so they wait for the numbers drill's words everywhere (Counting things too).
  { label: 'number words', min: 'all', steps: ['numbers-10', 'time-hours', 'money-100', 'dates-day', 'counting-one'], words: bySet(DIGIT_WORDS, DIGIT_MEANINGS, 'numeral') },
  // A price of exactly 100 or 1,000 says them, a year says them in some languages, and a count of 100 says "sto".
  { label: 'hundred', min: 'all', steps: ['numbers-999', 'money-1000', 'money-100'], extraSteps: { ...onSteps(['th', 'nb', 'de', 'fr', 'ja'], ['dates-year']), ...onSteps(['pl', 'ru'], ['counting-many']) }, words: single(HUNDRED, 'hundred', 'numeral') },
  { label: 'thousand', min: 'all', steps: ['numbers-big', 'money-10000', 'money-1000'], extraSteps: onSteps(ALL, ['dates-year']), words: single(THOUSAND, 'thousand', 'numeral') },
  { label: 'half', min: 'all', steps: ['time-hours'], words: Object.fromEntries(Object.entries(HALF).map(([l, entry]) => [l, one(entry, 'half', HALF_POS[l as Language])])) },
  { label: "o'clock", min: 'all', steps: ['time-hours'], words: single(OCLOCK, "o'clock") },
  { label: 'quarter', min: 'all', steps: ['time-quarters'], words: single(QUARTER, 'quarter') },
  { label: 'currency', min: 'all', steps: ['money-100'], words: Object.fromEntries(Object.entries(CURRENCY).map(([l, [entry, meaning]]) => [l, one(entry, meaning)])) },

  // ==== What each language's drills say beyond the above (read off the answers the drills give, tests/tools/skillWords.test.ts) ====

  // Day ordinals, for the languages that say the day as one (the others say a cardinal, `DAY_PIECES`).
  { label: 'day ordinals', min: MIN_ORDINALS, steps: ['dates-day'], words: bySet(ORDINAL_DAY_WORDS, ORDINAL_MEANINGS, 'numeral') },
  // The twelve-hour clock says eleven and twelve in the first step.
  { label: 'eleven and twelve', min: 'all', steps: ['time-hours'], words: {
    nb: numerals(TEEN_WORDS.nb?.slice(0, 2), TEEN_MEANINGS), de: numerals(TEEN_WORDS.de?.slice(0, 2), TEEN_MEANINGS), es: numerals(TEEN_WORDS.es?.slice(0, 2), TEEN_MEANINGS),
    el: numerals(TEEN_WORDS.el?.slice(0, 2), TEEN_MEANINGS), ru: numerals(TEEN_WORDS.ru?.slice(0, 2), TEEN_MEANINGS), fr: numerals(FR_TEENS.slice(0, 2), TEEN_MEANINGS),
  } },

  // ---- Norwegian ----
  { label: 'numbers 11 to 19', min: 'all', steps: TEEN_STEPS, words: { nb: numerals(TEEN_WORDS.nb, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: TENS_STEPS, words: { nb: numerals(TENS_WORDS.nb, TENS_MEANINGS) } },
  { label: 'twenty', min: 'all', steps: ['time-five'], words: { nb: one('tjue', 'twenty', 'numeral') } },
  { label: 'and', min: 'all', steps: ['numbers-999', 'money-1000', 'dates-year'], words: { nb: one('og', 'and', 'conjunction') } },
  { label: 'past', min: 'all', steps: ['time-quarters'], words: { nb: one('over', 'past', 'preposition') } },
  { label: 'to', min: 'all', steps: ['time-quarters'], words: { nb: one('på', 'to', 'preposition') } },
  { label: 'minute', min: 'all', steps: ['time-any'], words: { nb: one('minutt', 'minute') } },

  // ---- German ----
  { label: 'numbers 11 to 19', min: 'all', steps: TEEN_STEPS, words: { de: numerals(TEEN_WORDS.de, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: TENS_STEPS, words: { de: numerals(TENS_WORDS.de, TENS_MEANINGS) } },
  { label: 'twenty', min: 'all', steps: ['time-five'], words: { de: one('zwanzig', 'twenty', 'numeral') } },
  { label: 'and', min: 'all', steps: ['numbers-99', 'money-100', 'dates-year'], words: { de: one('und', 'and', 'conjunction') } },
  { label: 'past', min: 'all', steps: ['time-quarters'], words: { de: one('nach', 'past, after', 'preposition') } },
  { label: 'to', min: 'all', steps: ['time-quarters'], words: { de: one('vor', 'to, before', 'preposition') } },
  { label: 'a, one', min: 'all', steps: ['time-hours', 'money-100'], words: { de: one('ein', 'a, one', 'determiner') } },
  { label: 'the', min: 'all', steps: ['dates-day'], words: { de: one('der', 'the', 'determiner') } },

  // ---- Spanish ----
  { label: 'numbers 11 to 19', min: 'all', steps: TEEN_STEPS, words: { es: numerals(TEEN_WORDS.es, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: TENS_STEPS, words: { es: numerals(TENS_WORDS.es, TENS_MEANINGS) } },
  { label: 'twenty-one to twenty-nine', min: 'all', steps: TEEN_STEPS, words: { es: numerals(VEINTI_WORDS, VEINTI_MEANINGS) } },
  { label: 'twenty, twenty-five and thirty', min: 'all', steps: ['time-five'], words: { es: numerals(['veinte', 'veinticinco', 'treinta'], ['twenty', 'twenty-five', 'thirty']) } },
  { label: 'hundreds', min: 'all', steps: ['numbers-999', 'money-1000'], words: { es: numerals(['ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'], ['one hundred (before more)', 'two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred']) } },
  { label: 'nine hundred', min: 'all', steps: ['dates-year'], words: { es: one('novecientos', 'nine hundred', 'numeral') } },
  { label: 'the', min: 'all', steps: ['time-hours'], words: { es: one('la', 'the (la una, las dos)', 'determiner') } },
  { label: 'and', min: 'all', steps: ['time-hours', 'numbers-99', 'money-100', 'dates-year'], words: { es: one('y', 'and', 'conjunction') } },
  { label: 'to', min: 'all', steps: ['time-quarters'], words: { es: one('para', 'to, for (cuarto para las tres)', 'preposition') } },
  { label: 'minute', min: 'all', steps: ['time-any'], words: { es: one('minuto', 'minute') } },
  { label: 'of', min: 'all', steps: ['dates-day'], words: { es: one('de', 'of, from', 'preposition') } },
  { label: 'first', min: 'all', steps: ['dates-day'], words: { es: one('primero', 'first (the first of the month)', 'numeral') } },
  { label: 'centavo', min: 'all', steps: ['money-100'], words: { es: one('centavo', 'cent, one hundredth of a peso') } },
  { label: 'with', min: 'all', steps: ['money-100'], words: { es: one('con', 'with', 'preposition') } },

  // ---- French ----
  { label: 'numbers 11 to 16', min: 'all', steps: TEEN_STEPS, words: { fr: numerals(FR_TEENS, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: TENS_STEPS, words: { fr: numerals(TENS_WORDS.fr, TENS_MEANINGS) } },
  { label: 'eighty', min: 'all', steps: TENS_STEPS, words: { fr: one('quatre-vingts', 'eighty', 'numeral') } },
  { label: 'twenty and thirty', min: 'all', steps: ['time-five'], words: { fr: numerals(['vingt', 'trente'], ['twenty', 'thirty']) } },
  { label: 'time words', min: 'all', steps: ['time-hours'], words: { fr: [{ entry: 'heure', meaning: "hour, o'clock", pos: 'noun' }, { entry: 'midi', meaning: 'noon', pos: 'noun' }, { entry: 'minuit', meaning: 'midnight', pos: 'noun' }, { entry: 'une', meaning: 'one (feminine)', pos: 'numeral' }] } },
  { label: 'and', min: 'all', steps: ['time-hours', 'numbers-99', 'money-100', 'dates-year'], words: { fr: one('et', 'and', 'conjunction') } },
  { label: 'to', min: 'all', steps: ['time-quarters'], words: { fr: [{ entry: 'moins', meaning: 'minus, to (the hour)', pos: 'preposition' }, { entry: 'le', meaning: 'the', pos: 'determiner' }] } },
  { label: 'centime', min: 'all', steps: ['money-100'], words: { fr: one('centime', 'cent, one hundredth of a euro') } },
  { label: 'first', min: 'all', steps: ['dates-day'], words: { fr: one('premier', 'first', 'adjective') } },

  // ---- Greek ----
  { label: 'numbers 11 to 19', min: 'all', steps: TEEN_STEPS, words: { el: numerals(TEEN_WORDS.el, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: TENS_STEPS, words: { el: numerals(TENS_WORDS.el, TENS_MEANINGS) } },
  { label: 'twenty', min: 'all', steps: ['time-five'], words: { el: one('είκοσι', 'twenty', 'numeral') } },
  { label: 'thirty', min: 'all', steps: ['time-any'], words: { el: one('τριάντα', 'thirty', 'numeral') } },
  { label: 'hundreds', min: 'all', steps: ['numbers-999', 'money-1000'], words: { el: numerals(['διακόσια', 'τριακόσια', 'τετρακόσια', 'πεντακόσια', 'εξακόσια', 'εφτακόσια', 'οχτακόσια', 'εννιακόσια'], ['two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred']) } },
  { label: 'nine hundred', min: 'all', steps: ['dates-year'], words: { el: one('εννιακόσια', 'nine hundred', 'numeral') } },
  { label: 'one, three and four', min: 'all', steps: ['time-hours', 'numbers-big'], words: { el: numerals(['μία', 'τρεις', 'τέσσερις'], ['one (feminine)', 'three (masculine, feminine)', 'four (masculine, feminine)']) } },
  { label: 'thousands', min: 'all', steps: ['numbers-big', 'dates-year'], words: { el: one('χιλιάδα', 'thousand (the noun: δύο χιλιάδες)', 'noun') } },
  { label: 'first', min: 'all', steps: ['dates-day'], words: { el: one('πρώτος', 'first', 'adjective') } },
  { label: 'and', min: 'all', steps: ['time-hours', 'money-100'], words: { el: one('και', 'and', 'conjunction') } },
  { label: 'to', min: 'all', steps: ['time-quarters'], words: { el: one('παρά', 'to, before (of the hour)', 'preposition') } },
  { label: 'cent', min: 'all', steps: ['money-100'], words: { el: one('λεπτό', 'cent, minute (plural λεπτά)', 'noun') } },

  // ---- Japanese ----
  { label: 'special day readings', min: MIN_ORDINALS, steps: ['dates-day'], words: { ja: zip(JA_SPECIAL_DAYS, JA_SPECIAL_DAY_MEANINGS, 'noun') } },
  { label: 'day', min: 'all', steps: ['dates-day'], words: { ja: one('日', 'day (counter for days of the month)', 'classifier') } },
  { label: 'hour', min: 'all', steps: ['time-hours'], words: { ja: one('時', "o'clock, hour", 'classifier') } },
  { label: 'minute', min: 'all', steps: ['time-quarters'], words: { ja: one('分', 'minute', 'classifier') } },
  { label: 'ten thousand', min: 'all', steps: ['numbers-big', 'money-10000'], words: { ja: one('万', 'ten thousand', 'numeral') } },
  { label: 'year', min: 'all', steps: ['dates-year'], words: { ja: one('年', 'year', 'classifier') } },

  // ---- Thai ----
  { label: 'twenty (ยี่)', min: 'all', steps: ['time-five', 'numbers-99'], words: { th: [{ entry: 'ยี่', meaning: 'two, in twenty (ยี่สิบ)', pos: 'numeral' }] } },
  { label: 'one after a ten', min: 'all', steps: ['time-hours', 'numbers-99'], words: { th: [{ entry: 'เอ็ด', meaning: 'one, in eleven and twenty-one', pos: 'numeral' }] } },
  { label: 'ten thousand', min: 'all', steps: ['numbers-big', 'money-10000'], words: { th: one('หมื่น', 'ten thousand', 'numeral') } },
  { label: 'hundred thousand', min: 'all', steps: ['numbers-big'], words: { th: one('แสน', 'hundred thousand', 'numeral') } },
  { label: 'times of day', min: 'all', steps: ['time-hours'], words: { th: [
    { entry: 'เที่ยง', meaning: 'noon', pos: 'noun' }, { entry: 'คืน', meaning: 'night', pos: 'noun' }, { entry: 'ตี', meaning: "o'clock from 1 to 5 a.m.", pos: 'verb' },
    { entry: 'เช้า', meaning: 'morning', pos: 'noun' }, { entry: 'บ่าย', meaning: 'afternoon', pos: 'noun' }, { entry: 'เย็น', meaning: 'evening', pos: 'noun' }, { entry: 'ทุ่ม', meaning: "o'clock from 7 to 11 p.m.", pos: 'noun' },
  ] } },
  { label: 'minute', min: 'all', steps: ['time-quarters'], words: { th: one('นาที', 'minute', 'classifier') } },
  { label: 'date words', min: 'all', steps: ['dates-day'], words: { th: [{ entry: 'วัน', meaning: 'day', pos: 'noun' }, { entry: 'ที่', meaning: 'the (date marker: วันที่)', pos: 'particle' }] } },
  { label: 'Buddhist Era', min: 'all', steps: ['dates-year'], words: { th: one('พ.ศ.', 'Buddhist Era, the year count', 'noun') } },

  // ---- Polish ----
  { label: 'hour ordinals', min: 'all', steps: ['time-hours'], words: { pl: numerals(ORDINAL_DAY_WORDS.pl?.slice(0, 12), ORDINAL_MEANINGS) } },
  { label: 'to', min: 'all', steps: ['time-hours'], words: { pl: one('do', 'to, until', 'preposition') } },
  { label: 'past', min: 'all', steps: ['time-quarters'], words: { pl: one('po', 'after, past', 'preposition') } },
  { label: 'before', min: 'all', steps: ['time-quarters'], words: { pl: one('za', 'in, before (minutes to)', 'preposition') } },
  { label: 'twenty', min: 'all', steps: ['time-five'], words: { pl: one('dwadzieścia', 'twenty', 'numeral') } },
  { label: 'thirty', min: 'all', steps: ['time-any'], words: { pl: one('trzydzieści', 'thirty', 'numeral') } },
  { label: 'minute', min: 'all', steps: ['time-any'], words: { pl: one('minuta', 'minute') } },
  { label: 'numbers 11 to 19', min: 'all', steps: ['numbers-99', 'time-any', 'money-100', 'counting-many'], words: { pl: numerals(TEEN_WORDS.pl, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: ['numbers-99', 'money-100', 'counting-few'], words: { pl: numerals(TENS_WORDS.pl, TENS_MEANINGS) } },
  { label: 'hundreds', min: 'all', steps: ['numbers-999', 'money-1000'], words: { pl: numerals(['dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'], ['two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred']) } },
  { label: 'grosz', min: 'all', steps: ['money-100'], words: { pl: one('grosz', 'grosz, one hundredth of a zloty') } },
  { label: 'tens of the year', min: 'all', steps: ['dates-year'], words: { pl: numerals(['czterdziesty', 'pięćdziesiąty', 'sześćdziesiąty', 'siedemdziesiąty', 'osiemdziesiąty', 'dziewięćdziesiąty'], ['fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth']) } },
  { label: 'nine hundred', min: 'all', steps: ['dates-year'], words: { pl: one('dziewięćset', 'nine hundred', 'numeral') } },
  { label: 'year', min: 'all', steps: ['dates-year'], words: { pl: one('rok', 'year') } },

  // ---- Russian ----
  { label: 'hour ordinals', min: 'all', steps: ['time-hours'], words: { ru: numerals(ORDINAL_DAY_WORDS.ru?.slice(0, 12), ORDINAL_MEANINGS) } },
  { label: 'hour', min: 'all', steps: ['time-hours'], words: { ru: one('час', 'hour') } },
  { label: 'without', min: 'all', steps: ['time-quarters'], words: { ru: one('без', 'without, to (before the hour)', 'preposition') } },
  { label: 'minute', min: 'all', steps: ['time-five'], words: { ru: one('минута', 'minute') } },
  { label: 'twenty', min: 'all', steps: ['time-five'], words: { ru: one('двадцать', 'twenty', 'numeral') } },
  { label: 'thirty', min: 'all', steps: ['time-any'], words: { ru: one('тридцать', 'thirty', 'numeral') } },
  { label: 'numbers 11 to 19', min: 'all', steps: ['numbers-99', 'time-any', 'money-100', 'counting-many'], words: { ru: numerals(TEEN_WORDS.ru, TEEN_MEANINGS) } },
  { label: 'tens', min: 'all', steps: ['numbers-99', 'money-100', 'dates-year', 'counting-few'], words: { ru: numerals(TENS_WORDS.ru, TENS_MEANINGS) } },
  { label: 'hundreds', min: 'all', steps: ['numbers-999', 'money-1000'], words: { ru: numerals(['двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'], ['two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred']) } },
  { label: 'ordinals of the year', min: 'all', steps: ['dates-year'], words: { ru: numerals(ORDINAL_DAY_WORDS.ru, ORDINAL_MEANINGS) } },
  { label: 'tens of the year', min: 'all', steps: ['dates-year'], words: { ru: numerals(['сороковой', 'пятидесятый', 'шестидесятый', 'семидесятый', 'восьмидесятый', 'девяностый'], ['fortieth', 'fiftieth', 'sixtieth', 'seventieth', 'eightieth', 'ninetieth']) } },
  { label: 'nine hundred', min: 'all', steps: ['dates-year'], words: { ru: one('девятьсот', 'nine hundred', 'numeral') } },
  { label: 'year', min: 'all', steps: ['dates-year'], words: { ru: one('год', 'year') } },
];

/** A set of words a step waits for in the deck, and how many of them have to be studied. */
export interface WordNeed {
  words: readonly string[];
  min: number;
  /** What to call them when saying what's still missing ("3 more month names"). */
  label: string;
}

/**
 * What a drill step waits for in `language`: each set that names it, with the words the language has for it.
 * A Which word fits step waits for each of its set's words (contrasts.ts), which are the learner's own to add:
 * they aren't in `WORD_SETS`, so turning the skill on never adds them.
 */
export function stepNeeds(stepId: string, language: Language): WordNeed[] {
  if (stepId.startsWith(CONTRAST_STEP_PREFIX)) {
    const found = contrastSet(stepId.slice(CONTRAST_STEP_PREFIX.length));
    if (!found || found.language !== language) return [];
    return found.set.words.map((w) => ({ words: [w.word], min: 1, label: w.word }));
  }
  return WORD_SETS.flatMap((set): WordNeed[] => {
    const words = set.words[language];
    if (!words || !(set.steps.includes(stepId) || set.extraSteps?.[language]?.includes(stepId))) return [];
    return [{ words: words.map((w) => w.entry), min: set.min === 'all' ? words.length : set.min, label: set.label }];
  });
}

/** The months (1 to 12) the known headwords have, for a drill to ask only about those. */
export function knownMonths(language: Language, known: readonly string[]): number[] {
  const months = MONTH_WORDS[language];
  if (!months) return [];
  return knownAmong(months, known).flatMap((k, i) => (k ? [i + 1] : []));
}

/**
 * The words a day of the month is said with in each language (its entries in the sets above), so the dates
 * drill can ask only about days whose words are known (`knownDays`). Ordinals where the language says one,
 * with the tens before it from 21 (tjue + første); a cardinal in the others.
 */
const DAY_PIECES: Partial<Record<Language, (day: number) => string[]>> = {
  nb: (day) => {
    const ordinals = ORDINAL_DAY_WORDS.nb!;
    if (day <= 19) return [ordinals[day - 1]];
    if (day === 20 || day === 30) return [ordinals[day === 20 ? 19 : 20]];
    return [TENS_WORDS.nb![day < 30 ? 0 : 1], ordinals[(day % 10) - 1]];
  },
  // The first to nineteenth are ordinals; twentieth and thirtieth are the tens and -ste, and 21 is "einundzwanzigste".
  de: (day) => {
    if (day <= 19) return [ORDINAL_DAY_WORDS.de![day - 1]];
    const tens = TENS_WORDS.de![day < 30 ? 0 : 1];
    return day % 10 === 0 ? [tens] : [DIGIT_WORDS.de![(day % 10) - 1], 'und', tens];
  },
  // The day is a nominative ordinal (dwudziesty trzeci): twentieth and thirtieth are in the list, 21 to 29 and 31 are an ordinal tens + a unit.
  pl: (day) => ordinalDay(ORDINAL_DAY_WORDS.pl!, day),
  // Russian says the tens as a cardinal before the unit: двадцать третье.
  ru: (day) => ordinalDay(ORDINAL_DAY_WORDS.ru!, day, TENS_WORDS.ru),
  es: (day) => {
    if (day === 1) return ['primero'];
    if (day <= 10) return [DIGIT_WORDS.es![day - 1]];
    if (day <= 19) return [TEEN_WORDS.es![day - 11]];
    if (day === 20) return ['veinte'];
    if (day <= 29) return [VEINTI_WORDS[day - 21]];
    return day === 30 ? ['treinta'] : ['treinta', 'y', DIGIT_WORDS.es![0]];
  },
  fr: (day) => {
    if (day === 1) return ['premier'];
    if (day <= 10) return [DIGIT_WORDS.fr![day - 1]];
    if (day <= 16) return [FR_TEENS[day - 11]];
    if (day <= 19) return ['dix', DIGIT_WORDS.fr![day - 11]];
    const tens = TENS_WORDS.fr![day < 30 ? 0 : 1];
    if (day % 10 === 0) return [tens];
    return day % 10 === 1 ? [tens, 'et', DIGIT_WORDS.fr![0]] : [tens, DIGIT_WORDS.fr![(day % 10) - 1]];
  },
  // A feminine cardinal: the first is πρώτη, and one, three and four take their feminine forms.
  el: (day) => {
    const units = ['μία', 'δύο', 'τρεις', 'τέσσερις', 'πέντε', 'έξι', 'εφτά', 'οχτώ', 'εννιά'];
    if (day === 1) return ['πρώτος'];
    if (day <= 9) return [units[day - 1]];
    if (day === 10) return [DIGIT_WORDS.el![9]];
    if (day <= 19) return [TEEN_WORDS.el![day - 11]];
    const tens = TENS_WORDS.el![day < 30 ? 0 : 1];
    return day % 10 === 0 ? [tens] : [tens, units[(day % 10) - 1]];
  },
  // A cardinal after "the date": ten is สิบ, two in the twenties is ยี่ and one after a ten is เอ็ด.
  th: (day) => {
    const digits = DIGIT_WORDS.th!;
    const tens = Math.floor(day / 10);
    const units = day % 10;
    const out: string[] = [];
    if (tens === 1) out.push(digits[9]);
    else if (tens === 2) out.push('ยี่', digits[9]);
    else if (tens === 3) out.push(digits[2], digits[9]);
    if (units === 1 && tens) out.push('เอ็ด');
    else if (units) out.push(digits[units - 1]);
    return out;
  },
  // 1 to 10, 14, 20 and 24 are read specially, the rest are numeral + 十 + numeral, and every day ends in 日.
  ja: (day) => {
    const special = JA_SPECIAL_DAYS.find((w) => w === `${japaneseDayNumeral(day)}日`);
    if (special) return [special];
    const digits = DIGIT_WORDS.ja!;
    const tens = Math.floor(day / 10);
    const units = day % 10;
    return [...(tens > 1 ? [digits[tens - 1]] : []), digits[9], ...(units ? [digits[units - 1]] : []), '日'];
  },
};

/** The first to nineteenth, twentieth and thirtieth are in the list; 21 to 29 and 31 are a tens word (the ordinal, or `tens` where the language says the cardinal) and a unit ordinal. */
function ordinalDay(ordinals: readonly string[], day: number, tens?: readonly string[]): string[] {
  if (day <= 19) return [ordinals[day - 1]];
  if (day === 20 || day === 30) return [ordinals[day === 20 ? 19 : 20]];
  return [tens ? tens[day < 30 ? 0 : 1] : ordinals[day < 30 ? 19 : 20], ordinals[(day % 10) - 1]];
}

/** The numeral a day is written with before 日 (二十四 for 24), for finding its special reading. */
function japaneseDayNumeral(day: number): string {
  const digits = DIGIT_WORDS.ja!;
  const tens = Math.floor(day / 10);
  const units = day % 10;
  return `${tens > 1 ? digits[tens - 1] : ''}${tens ? digits[9] : ''}${units ? digits[units - 1] : ''}`;
}

/**
 * The days of the month (1 to 31) whose words the known headwords have, for a drill to ask only about
 * those; empty for a language with no day table (`DAY_PIECES`), which asks about every day.
 */
export function knownDays(language: Language, known: readonly string[]): number[] {
  const pieces = DAY_PIECES[language];
  if (!pieces) return [];
  return Array.from({ length: 31 }, (_, i) => i + 1).filter((day) => knownAmong(pieces(day), known).every(Boolean));
}

/** What one need still lacks, for the Skills screen ("3 more month names", "weekday names", or the one word), or undefined once it has enough. */
export function stillNeeded(need: WordNeed, known: readonly string[]): string | undefined {
  const have = knownAmong(need.words, known).filter(Boolean).length;
  if (have >= need.min) return undefined;
  if (need.words.length === 1) return need.words[0];
  return need.min === need.words.length ? need.label : `${need.min - have} more ${need.label}`;
}

export interface SkillWordDraft {
  fields: Record<string, string>;
  tags: string[];
}

/** The note for one word: the fields Read & Listen's mined words start with, and the language the deck's notes name. */
function wordDraft(language: Language, word: SkillWord): SkillWordDraft {
  return {
    fields: { Entry: word.entry, Meaning: word.meaning, Language: LANGUAGES[language].name.toLowerCase(), PartOfSpeech: word.pos ?? 'noun', GenerateReverse: 'y' },
    tags: [SKILL_WORDS_TAG],
  };
}

/** The words the drill steps of `group` ("time", "dates"...) wait for in `language`, each once. */
export function groupWords(group: string, language: Language): SkillWord[] {
  const seen = new Set<string>();
  const inGroup = (steps: readonly string[] | undefined) => !!steps?.some((s) => s.startsWith(`${group}-`));
  return WORD_SETS.flatMap((set) => (inGroup(set.steps) || inGroup(set.extraSteps?.[language]) ? set.words[language] ?? [] : []))
    .filter((w) => !seen.has(w.entry) && !!seen.add(w.entry));
}

/** Every word the skills in `groups` need in `language`, as notes, each once (a hundred serves both numbers and money). */
export function wordDrafts(language: Language, groups: readonly string[]): SkillWordDraft[] {
  const seen = new Set<string>();
  return groups.flatMap((g) => groupWords(g, language)).filter((w) => !seen.has(w.entry) && !!seen.add(w.entry)).map((w) => wordDraft(language, w));
}
