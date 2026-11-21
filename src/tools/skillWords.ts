import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { SKILL_WORDS_TAG } from '../core/priority';

/**
 * The words a skill's drills are said in, which a learner can't answer without: the months for
 * Saying dates, the weekdays for its weekday steps. A skill is worthless on words the learner never
 * studied, so turning it on adds the ones the deck lacks as ordinary notes (`skillWordDrafts`), tagged
 * `skill::words` so Review brings some of them up each day (`SKILL_WORDS_PERCENT`, src/core/priority.ts),
 * and a drill only asks about words the deck has studied (`knownMonths`, `stepNeeds`). Nothing here
 * rates, schedules or writes a card.
 */

/** The month names in each language, January first, in the form a dictionary lists them. */
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

export const MONTH_MEANINGS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const WEEKDAY_MEANINGS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** The note type the words are written in: the one the deck's own words are. */
export const SKILL_WORD_NOTE_TYPE = 'Omnilanguage';

/** How many months must be studied before the first dates step opens: it then asks only about the months known. */
export const MIN_MONTHS = 3;

/** A set of words a step waits for in the deck, and how many of them have to be studied. */
export interface WordNeed {
  words: readonly string[];
  min: number;
  /** What to call them when saying what's still missing ("3 more month names"). */
  label: string;
}

/** The words a drill step waits for: the months for every dates step, the weekdays for the steps that say one. */
export function dateNeeds(stepId: string, language: Language): WordNeed[] {
  const months = MONTH_WORDS[language];
  const weekdays = WEEKDAY_WORDS[language];
  if (!months || !weekdays || !stepId.startsWith('dates-')) return [];
  const needs: WordNeed[] = [{ words: months, min: MIN_MONTHS, label: 'month names' }];
  if (stepId !== 'dates-day') needs.push({ words: weekdays, min: weekdays.length, label: 'weekday names' });
  return needs;
}

const norm = (w: string) => w.normalize('NFC').toLocaleLowerCase().trim();

/**
 * The words of `words` the studied headwords have: one counts when a headword is it, or has it as a
 * word of its own ("luty" in "luty, miesiąc"). Thai and Japanese aren't written with spaces, so
 * there it has to be the whole headword.
 */
export function knownAmong(words: readonly string[], studied: readonly string[]): boolean[] {
  const known = new Set(studied.flatMap((t) => [norm(t), ...norm(t).split(/[^\p{L}\p{N}]+/u)]).filter(Boolean));
  return words.map((w) => known.has(norm(w)));
}

/** The months (1 to 12) the studied headwords have, for a drill to ask only about those. */
export function knownMonths(language: Language, studied: readonly string[]): number[] {
  const months = MONTH_WORDS[language];
  if (!months) return [];
  return knownAmong(months, studied).flatMap((k, i) => (k ? [i + 1] : []));
}

/** What one need still lacks, for the Skills screen ("3 more month names", or all of them: "weekday names"), or undefined once it has enough. */
export function stillNeeded(need: WordNeed, studied: readonly string[]): string | undefined {
  const have = knownAmong(need.words, studied).filter(Boolean).length;
  if (have >= need.min) return undefined;
  return need.min === need.words.length ? need.label : `${need.min - have} more ${need.label}`;
}

export interface SkillWordDraft {
  fields: Record<string, string>;
  tags: string[];
}

/** The note for one word: the fields Read & Listen's mined words start with, and the language the deck's notes name. */
function wordDraft(language: Language, entry: string, meaning: string): SkillWordDraft {
  return {
    fields: { Entry: entry, Meaning: meaning, Language: LANGUAGES[language].name.toLowerCase(), PartOfSpeech: 'noun', GenerateReverse: 'y' },
    tags: [SKILL_WORDS_TAG],
  };
}

/** Every word the dates skill needs in `language`: the twelve months, then the seven weekdays. */
export function dateWordDrafts(language: Language): SkillWordDraft[] {
  const months = MONTH_WORDS[language] ?? [];
  const weekdays = WEEKDAY_WORDS[language] ?? [];
  return [
    ...months.map((m, i) => wordDraft(language, m, MONTH_MEANINGS[i])),
    ...weekdays.map((d, i) => wordDraft(language, d, WEEKDAY_MEANINGS[i])),
  ];
}
