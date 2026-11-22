import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { SKILL_WORDS_TAG } from '../core/priority';

/**
 * The words a skill's drills are said in, which a learner can't answer without: the months and the day
 * ordinals for Saying dates, the number words for Numbers, "half" for telling the time, the currency for
 * Counting money. A skill is worthless on words the learner doesn't know, so turning it on adds the ones
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
interface WordSet {
  /** What to call the set when saying what's missing ("3 more month names"). */
  label: string;
  /** How many of the words must be studied, or all of them. */
  min: number | 'all';
  /** The drill steps that wait for it. */
  steps: readonly string[];
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
 * The day ordinals (first to nineteenth, then twentieth and thirtieth), which a date says the day with: the rest
 * are built from these and the tens (tjueførste, trettiførste). Norwegian only so far; the other languages'
 * drills still say a day whether or not its word is known.
 */
export const ORDINAL_DAY_WORDS: Partial<Record<Language, readonly string[]>> = {
  nb: ['første', 'andre', 'tredje', 'fjerde', 'femte', 'sjette', 'sjuende', 'åttende', 'niende', 'tiende', 'ellevte', 'tolvte', 'trettende', 'fjortende', 'femtende', 'sekstende', 'syttende', 'attende', 'nittende', 'tjuende', 'trettiende'],
};
/** Eleven to nineteen, and the tens twenty to ninety: what 11 to 99 and a year are said with. Norwegian only so far. */
export const TEEN_WORDS: Partial<Record<Language, readonly string[]>> = { nb: ['elleve', 'tolv', 'tretten', 'fjorten', 'femten', 'seksten', 'sytten', 'atten', 'nitten'] };
export const TENS_WORDS: Partial<Record<Language, readonly string[]>> = { nb: ['tjue', 'tretti', 'førti', 'femti', 'seksti', 'sytti', 'åtti', 'nitti'] };

/** The words for a hundred and a thousand, which the hundreds and thousands steps can't be said without. */
const HUNDRED: Partial<Record<Language, string>> = { th: 'ร้อย', pl: 'sto', ru: 'сто', de: 'hundert', es: 'cien', fr: 'cent', el: 'εκατό', nb: 'hundre', ja: '百' };
const THOUSAND: Partial<Record<Language, string>> = { th: 'พัน', pl: 'tysiąc', ru: 'тысяча', de: 'tausend', es: 'mil', fr: 'mille', el: 'χίλια', nb: 'tusen', ja: '千' };
/** "Half" for the half-past step (Polish says "wpół do", so the word is wpół), and "quarter" for the quarter-past step (Thai and Japanese say the minutes instead). */
const HALF: Partial<Record<Language, string>> = { th: 'ครึ่ง', es: 'media', fr: 'demi', de: 'halb', el: 'μισή', ja: '半', nb: 'halv', pl: 'wpół', ru: 'половина' };
/** The word the hour is said with, which Thai (เก้าโมง) can't tell the time without. */
const OCLOCK: Partial<Record<Language, string>> = { th: 'โมง' };
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

const WORD_SETS: readonly WordSet[] = [
  { label: 'month names', min: MIN_MONTHS, steps: ['dates-day', 'dates-weekday', 'dates-year'], words: bySet(MONTH_WORDS, MONTH_MEANINGS) },
  { label: 'weekday names', min: 'all', steps: ['dates-weekday', 'dates-year'], words: bySet(WEEKDAY_WORDS, WEEKDAY_MEANINGS) },
  { label: 'number words', min: 'all', steps: ['numbers-10'], words: bySet(DIGIT_WORDS, DIGIT_MEANINGS, 'numeral') },
  { label: 'hundred', min: 'all', steps: ['numbers-999', 'money-1000'], words: single(HUNDRED, 'hundred', 'numeral') },
  { label: 'thousand', min: 'all', steps: ['numbers-big', 'money-10000'], words: single(THOUSAND, 'thousand', 'numeral') },
  { label: 'half', min: 'all', steps: ['time-hours'], words: single(HALF, 'half', 'adjective') },
  { label: "o'clock", min: 'all', steps: ['time-hours'], words: single(OCLOCK, "o'clock") },
  { label: 'quarter', min: 'all', steps: ['time-quarters'], words: single(QUARTER, 'quarter') },
  { label: 'currency', min: 'all', steps: ['money-100'], words: Object.fromEntries(Object.entries(CURRENCY).map(([l, [entry, meaning]]) => [l, one(entry, meaning)])) },
  // Norwegian's day ordinals, the numbers 11 to 99 and the small words its drills say; the other languages' are still to come.
  { label: 'day ordinals', min: MIN_ORDINALS, steps: ['dates-day'], words: bySet(ORDINAL_DAY_WORDS, ORDINAL_MEANINGS, 'numeral') },
  { label: 'numbers 11 to 19', min: 'all', steps: ['numbers-99', 'time-any', 'money-100', 'dates-year'], words: bySet(TEEN_WORDS, TEEN_MEANINGS, 'numeral') },
  { label: 'tens', min: 'all', steps: ['numbers-99', 'money-100', 'dates-year'], words: bySet(TENS_WORDS, TENS_MEANINGS, 'numeral') },
  { label: 'twenty', min: 'all', steps: ['time-five'], words: { nb: one('tjue', 'twenty', 'numeral') } },
  { label: 'hundred', min: 'all', steps: ['dates-year'], words: { nb: one('hundre', 'hundred', 'numeral') } },
  { label: 'thousand', min: 'all', steps: ['dates-year'], words: { nb: one('tusen', 'thousand', 'numeral') } },
  { label: 'and', min: 'all', steps: ['numbers-999', 'money-1000', 'dates-year'], words: { nb: one('og', 'and', 'conjunction') } },
  { label: 'past', min: 'all', steps: ['time-quarters'], words: { nb: one('over', 'past', 'preposition') } },
  { label: 'to', min: 'all', steps: ['time-quarters'], words: { nb: one('på', 'to', 'preposition') } },
  { label: 'minute', min: 'all', steps: ['time-any'], words: { nb: one('minutt', 'minute') } },
];

/** A set of words a step waits for in the deck, and how many of them have to be studied. */
export interface WordNeed {
  words: readonly string[];
  min: number;
  /** What to call them when saying what's still missing ("3 more month names"). */
  label: string;
}

/** What a drill step waits for in `language`: each set that names it, with the words the language has for it. */
export function stepNeeds(stepId: string, language: Language): WordNeed[] {
  return WORD_SETS.flatMap((set): WordNeed[] => {
    const words = set.words[language];
    if (!words || !set.steps.includes(stepId)) return [];
    return [{ words: words.map((w) => w.entry), min: set.min === 'all' ? words.length : set.min, label: set.label }];
  });
}

const norm = (w: string) => w.normalize('NFC').toLocaleLowerCase().trim();

/**
 * The words of `words` the known headwords have: one counts when a headword is it, or has it as a
 * word of its own ("luty" in "luty, miesiąc"). Thai and Japanese aren't written with spaces, so
 * there it has to be the whole headword.
 */
export function knownAmong(words: readonly string[], headwords: readonly string[]): boolean[] {
  const known = new Set(headwords.flatMap((t) => [norm(t), ...norm(t).split(/[^\p{L}\p{N}]+/u)]).filter(Boolean));
  return words.map((w) => known.has(norm(w)));
}

/** The months (1 to 12) the known headwords have, for a drill to ask only about those. */
export function knownMonths(language: Language, known: readonly string[]): number[] {
  const months = MONTH_WORDS[language];
  if (!months) return [];
  return knownAmong(months, known).flatMap((k, i) => (k ? [i + 1] : []));
}

/** The words a day of the month is said with: its ordinal, with the tens before it from 21 (tjue + første). */
const DAY_PIECES: Partial<Record<Language, (day: number) => string[]>> = {
  nb: (day) => {
    const ordinals = ORDINAL_DAY_WORDS.nb!;
    if (day <= 19) return [ordinals[day - 1]];
    if (day === 20 || day === 30) return [ordinals[day === 20 ? 19 : 20]];
    return [TENS_WORDS.nb![day < 30 ? 0 : 1], ordinals[(day % 10) - 1]];
  },
};

/**
 * The days of the month (1 to 31) whose words the known headwords have, for a drill to ask only about
 * those; empty for a language whose days aren't gated, which asks about every day.
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
  return WORD_SETS.flatMap((set) => (set.steps.some((s) => s.startsWith(`${group}-`)) ? set.words[language] ?? [] : []))
    .filter((w) => !seen.has(w.entry) && !!seen.add(w.entry));
}

/** Every word the skills in `groups` need in `language`, as notes, each once (a hundred serves both numbers and money). */
export function wordDrafts(language: Language, groups: readonly string[]): SkillWordDraft[] {
  const seen = new Set<string>();
  return groups.flatMap((g) => groupWords(g, language)).filter((w) => !seen.has(w.entry) && !!seen.add(w.entry)).map((w) => wordDraft(language, w));
}
