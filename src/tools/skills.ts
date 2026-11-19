import type { Language } from '../reader/api';
import { speechLangFor } from '../core/cards';
import { headword } from '../core/forms';
import type { Note } from '../core/types';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import type { NumberQuestion, NumberSaying } from './number';
import type { Phrase } from './phrase';
import { pickOther } from './random';
import { clockText, randomTime, type ClockTime, type MinuteStep, type TimeSaying } from './time';
import { CASE_LANGUAGES, caseName, caseRule, governorId } from './cases';
import { randomDate, weekdayOf, type CalendarDate, type DateParts } from './date';
import { CURRENCIES, randomAmount, type MoneyMax } from './money';
import { CLASS_NAMES, CONSONANTS, VOWELS, vowelSteps, vowelSyllable } from './thai/letters';
import { COUNTING, CURRENCY_OF, DATE_SAYERS, MONEY_SAYERS, NUMBER_SAYERS, TIME_SAYERS } from './tools';

/**
 * Skill cards' drills: a skill with endless questions (any time, any number) as a ladder of steps,
 * each of which becomes one card in the collection. When the card comes up, its drill asks a few
 * questions drawn from the step (here), and the rating the learner taps for the card schedules the
 * skill. Nothing here rates, schedules or writes a card: `suggestedRating` only says which button to
 * outline (src/ui/tools/SkillDrill.tsx), and the learner's tap is what reaches FSRS.
 */

export type DrillGroup = 'time' | 'numbers' | 'dates' | 'money';

export interface DrillStep {
  /** Stable across versions: it's written into the card (`SkillId`) and read back to find the drill. */
  id: string;
  group: DrillGroup;
  title: string;
  /** The step before, which settles first: this one is added suspended and released after it. */
  after?: string;
  /** What Anki on the computer shows, where there's no drill: something to do without the app, then rate. */
  selfCheck: string;
}

interface TimeStep extends DrillStep { group: 'time'; minutes: 'hours' | 'quarters' | MinuteStep }
interface NumberStep extends DrillStep { group: 'numbers'; min: number; max: number }
interface DateStep extends DrillStep { group: 'dates'; parts: DateParts }
interface MoneyStep extends DrillStep { group: 'money'; max: MoneyMax }

export const TIME_STEPS: TimeStep[] = [
  { id: 'time-hours', group: 'time', title: "O'clock and half past", minutes: 'hours', selfCheck: 'Say three times aloud: one on the hour, one at half past, one in the evening.' },
  { id: 'time-quarters', group: 'time', title: 'Quarter past and to', minutes: 'quarters', after: 'time-hours', selfCheck: 'Say three times aloud at a quarter past or a quarter to the hour, morning and afternoon.' },
  { id: 'time-five', group: 'time', title: 'Five-minute steps', minutes: 5, after: 'time-quarters', selfCheck: 'Say three times aloud on five-minute steps, such as 10:25 or 16:50.' },
  { id: 'time-any', group: 'time', title: 'Any minute', minutes: 1, after: 'time-five', selfCheck: 'Say three times aloud at any minute, such as 07:13 or 21:48.' },
];

export const NUMBER_STEPS: NumberStep[] = [
  { id: 'numbers-10', group: 'numbers', title: '1 to 10', min: 1, max: 10, selfCheck: 'Count from 1 to 10 aloud, then say 3, 7 and 9 on their own.' },
  { id: 'numbers-99', group: 'numbers', title: '11 to 99', min: 11, max: 99, after: 'numbers-10', selfCheck: 'Say three numbers between 11 and 99 aloud, such as 17, 40 and 85.' },
  { id: 'numbers-999', group: 'numbers', title: 'Hundreds', min: 100, max: 999, after: 'numbers-99', selfCheck: 'Say three numbers between 100 and 999 aloud, such as 105, 360 and 999.' },
  { id: 'numbers-big', group: 'numbers', title: 'Thousands and up', min: 1000, max: 999_999, after: 'numbers-999', selfCheck: 'Say three numbers in the thousands aloud, such as 2,400, 15,031 and 680,000.' },
];

export const DATE_STEPS: DateStep[] = [
  { id: 'dates-day', group: 'dates', title: 'Day and month', parts: { weekday: false, year: false }, selfCheck: "Say today's date aloud, then your birthday, then the first of next month." },
  { id: 'dates-weekday', group: 'dates', title: 'With the weekday', parts: { weekday: true, year: false }, after: 'dates-day', selfCheck: "Say today's date aloud with its weekday, then the same for a week from now." },
  { id: 'dates-year', group: 'dates', title: 'With the weekday and year', parts: { weekday: true, year: true }, after: 'dates-weekday', selfCheck: 'Say aloud the full date of today, of your birthday this year, and of New Year\'s Day.' },
];

export const MONEY_STEPS: MoneyStep[] = [
  { id: 'money-100', group: 'money', title: 'Prices up to 100', max: 100, selfCheck: 'Say three small prices aloud, such as a coffee, a snack and a bus fare.' },
  { id: 'money-1000', group: 'money', title: 'Prices up to 1,000', max: 1000, after: 'money-100', selfCheck: 'Say three prices up to 1,000 aloud, such as a meal, a shirt and a taxi.' },
  { id: 'money-10000', group: 'money', title: 'Prices up to 10,000', max: 10000, after: 'money-1000', selfCheck: 'Say three prices up to 10,000 aloud, such as a phone, a flight and a month\'s rent.' },
];

export const DRILL_STEPS: DrillStep[] = [...TIME_STEPS, ...NUMBER_STEPS, ...DATE_STEPS, ...MONEY_STEPS];

export const GROUP_TITLES: Record<DrillGroup, string> = { time: 'Telling the time', numbers: 'Numbers', dates: 'Saying dates', money: 'Counting money' };

export const drillStep = (id: string): DrillStep | undefined => DRILL_STEPS.find((s) => s.id === id);

/** Whether the language has the drills of a group (a saying for each question). */
export function hasDrills(group: DrillGroup, language: Language): boolean {
  if (group === 'time') return !!TIME_SAYERS[language];
  if (group === 'numbers') return !!NUMBER_SAYERS[language];
  if (group === 'dates') return !!DATE_SAYERS[language];
  return !!MONEY_SAYERS[language] && !!CURRENCY_OF[language];
}

/** How many questions a drill asks before the card is rated. */
export const DRILL_QUESTIONS = 3;

export type DrillQuestion =
  | { kind: 'time'; time: ClockTime }
  | { kind: 'number'; question: NumberQuestion }
  | { kind: 'date'; date: CalendarDate; parts: DateParts }
  | { kind: 'money'; amount: number };

/** A question's key, so the same one isn't asked twice in a row. */
export function questionKey(q: DrillQuestion): string {
  switch (q.kind) {
    case 'time': return clockText(q.time);
    case 'number': return String(q.question.kind === 'phone' ? q.question.written : q.question.n);
    case 'date': return `${q.date.year}-${q.date.month}-${q.date.day}`;
    case 'money': return String(q.amount);
  }
}

/** A question for `step` in `language`, never `previous` again. */
export function drawQuestion(step: DrillStep, previous?: DrillQuestion, random: () => number = Math.random, language?: Language): DrillQuestion {
  if (step.group === 'dates') {
    const s = step as DateStep;
    return { kind: 'date', date: randomDate(previous?.kind === 'date' ? previous.date : undefined, random), parts: s.parts };
  }
  if (step.group === 'money') {
    const s = step as MoneyStep;
    const currency = CURRENCIES[(language && CURRENCY_OF[language]) || 'EUR'];
    return { kind: 'money', amount: randomAmount(currency, s.max, previous?.kind === 'money' ? previous.amount : undefined, random) };
  }
  if (step.group === 'time') {
    const s = step as TimeStep;
    const last = previous?.kind === 'time' ? previous.time : undefined;
    if (s.minutes === 'hours') return { kind: 'time', time: randomTime(30, last, random) };
    if (s.minutes === 'quarters') {
      // Only a quarter past or to: the hour and the half were the step before.
      const slot = pickOther(48, last && (last.minute === 15 || last.minute === 45) ? last.hour * 2 + (last.minute === 45 ? 1 : 0) : undefined, random);
      return { kind: 'time', time: { hour: Math.floor(slot / 2), minute: slot % 2 ? 45 : 15 } };
    }
    return { kind: 'time', time: randomTime(s.minutes, last, random) };
  }
  const s = step as NumberStep;
  const last = previous?.kind === 'number' && previous.question.kind === 'number' ? previous.question.n : undefined;
  const span = s.max - s.min + 1;
  // Thousands and up: a few digits more often than not, so 4,500 comes up as often as 845,302.
  const n = s.max >= 100_000
    ? (() => { const digits = 4 + Math.floor(random() * 3); const lo = 10 ** (digits - 1); return lo + pickOther(10 ** digits - lo, last !== undefined && last >= lo && last < 10 ** digits ? last - lo : undefined, random); })()
    : s.min + pickOther(span, last !== undefined && last >= s.min && last <= s.max ? last - s.min : undefined, random);
  return { kind: 'number', question: { kind: 'number', n } };
}

/**
 * The next question of a drill: the first of `retry` (questions missed when the card was last
 * answered Again, asked again when it comes back) that isn't `previous`, else a fresh draw.
 * Returns what's left of `retry` too.
 */
export function nextDrillQuestion(step: DrillStep, previous: DrillQuestion | undefined, retry: readonly DrillQuestion[], random: () => number = Math.random, language?: Language): { question: DrillQuestion; retry: DrillQuestion[] } {
  const at = retry.findIndex((q) => !previous || questionKey(q) !== questionKey(previous));
  if (at < 0) return { question: drawQuestion(step, previous, random, language), retry: [...retry] };
  return { question: retry[at], retry: retry.filter((_, i) => i !== at) };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** How a question reads on the card: its digits ("14:45", "2,400"), the date in English with the parts asked, or the price as the language writes it. */
export function questionText(q: DrillQuestion, language?: Language): string {
  switch (q.kind) {
    case 'time': return clockText(q.time);
    case 'number': return q.question.kind === 'phone' ? q.question.written : q.question.n.toLocaleString('en-US');
    case 'date': {
      const day = `${MONTHS[q.date.month - 1]} ${q.date.day}`;
      const withDay = q.parts.weekday ? `${WEEKDAYS[weekdayOf(q.date)]}, ${day}` : day;
      return q.parts.year ? `${withDay}, ${q.date.year}` : withDay;
    }
    case 'money': return (language && MONEY_SAYERS[language]?.(q.amount).written.text) ?? String(q.amount);
  }
}

/** A question's answer in `language`: the usual way to say it, the other ways heard, and a formal or written form where there is one. */
export function drillAnswer(q: DrillQuestion, language: Language): { everyday: Phrase; also: Phrase[]; last?: { title: string; phrase: Phrase } } | undefined {
  if (q.kind === 'time') {
    const s: TimeSaying | undefined = TIME_SAYERS[language]?.(q.time);
    return s && { everyday: s.everyday, also: s.also, last: { title: 'Formal', phrase: s.formal } };
  }
  if (q.kind === 'date') {
    const s = DATE_SAYERS[language]?.(q.date, q.parts);
    return s && { everyday: s.everyday, also: s.also, last: { title: 'As written', phrase: s.written } };
  }
  if (q.kind === 'money') {
    const s = MONEY_SAYERS[language]?.(q.amount);
    return s && { everyday: s.everyday, also: s.also };
  }
  const s: NumberSaying | undefined = NUMBER_SAYERS[language]?.(q.question);
  return s && { everyday: s.everyday, also: s.also };
}

/**
 * The rating to suggest once a drill is done, as a button's number (1 Again, 2 Hard, 3 Good): all
 * right is Good, one miss Hard, more Again. Only a suggestion: the learner taps the rating, and
 * Easy is theirs to choose.
 */
export function suggestedRating(results: readonly boolean[], thinkMs: readonly number[] = [], group?: DrillGroup): 1 | 2 | 3 {
  const missed = results.filter((r) => !r).length;
  if (missed) return missed === 1 ? 2 : 1;
  return group && isSlow(thinkMs, group) ? 2 : 3;
}

/**
 * How long answering may take, per question, before an all-right drill counts as slow: telling the
 * time or a price is about speed as much as being right, so a right answer worked out slowly is Hard.
 * The time is from the question coming up to Show answer, or to the end of speaking it.
 */
export const SLOW_MS: Record<DrillGroup, number> = { time: 6000, numbers: 5000, dates: 9000, money: 7000 };

/** The middle of the times taken: one long pause (a distraction) doesn't make a drill slow. */
export function medianMs(times: readonly number[]): number | undefined {
  if (!times.length) return undefined;
  const sorted = [...times].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function isSlow(times: readonly number[], group: DrillGroup): boolean {
  const m = medianMs(times);
  return m !== undefined && m > SLOW_MS[group];
}

// ==== Answering aloud ====

const squeezed = (s: string) => s.normalize('NFC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** The digits a question can be said back as by the phone's recognizer, which often writes numbers as digits ("1350", "14 45"). None for a date. */
function questionDigits(q: DrillQuestion): string[] {
  switch (q.kind) {
    case 'time': {
      const h12 = q.time.hour % 12 || 12;
      const mm = String(q.time.minute).padStart(2, '0');
      return [`${q.time.hour}${mm}`, `${h12}${mm}`, ...(q.time.minute ? [] : [String(q.time.hour), String(h12)])];
    }
    case 'number': return q.question.kind === 'phone' ? [q.question.written.replace(/\D/g, '')] : [String(q.question.n)];
    case 'money': {
      const major = Math.floor(q.amount / 100);
      const minor = q.amount % 100;
      return minor ? [`${major}${String(minor).padStart(2, '0')}`] : [String(major), `${major}00`];
    }
    case 'date': return [];
  }
}

/**
 * Whether what the phone heard is the answer: any accepted way of saying it, with spaces and
 * punctuation ignored, or the question's own digits when the recognizer wrote the number out as
 * digits. Only a suggestion for the drill's own mark; the learner still taps Missed it or Got it.
 */
export function heardRight(q: DrillQuestion, heard: string, language: Language): boolean {
  const said = squeezed(heard);
  if (!said) return false;
  const answer = drillAnswer(q, language);
  const ways = answer ? [answer.everyday, ...answer.also, ...(answer.last ? [answer.last.phrase] : [])] : [];
  if (ways.some((p) => squeezed(p.text) === said)) return true;
  const digits = heard.replace(/\D/g, '');
  return !!digits && digits === heard.replace(/[^\d\p{L}]/gu, '') && questionDigits(q).includes(digits);
}

// ==== Waiting for vocabulary ====

/** The words for a hundred and a thousand, which the hundreds and thousands steps can't be said without. */
const HUNDRED_THOUSAND: Partial<Record<Language, [string, string]>> = {
  th: ['ร้อย', 'พัน'], pl: ['sto', 'tysiąc'], ru: ['сто', 'тысяча'], de: ['hundert', 'tausend'], es: ['cien', 'mil'],
  fr: ['cent', 'mille'], el: ['εκατό', 'χίλια'], nb: ['hundre', 'tusen'], ja: ['百', '千'],
};

/** The words a drill step waits for in the deck, besides the step before it settling. */
export function stepWords(stepId: string, language: Language): string[] {
  const ht = HUNDRED_THOUSAND[language];
  if (ht && (stepId === 'numbers-999' || stepId === 'money-1000')) return [ht[0]];
  if (ht && (stepId === 'numbers-big' || stepId === 'money-10000')) return [ht[1]];
  if (language === 'pl' && stepId === 'time-quarters') return ['kwadrans'];
  return [];
}

/**
 * The words of `words` the deck hasn't got, studied: a word counts when a studied note's headword
 * is it, or has it as a word of its own ("sto" in "sto, setka"). Thai and Japanese aren't written with
 * spaces, so there it has to be the whole headword.
 */
export function missingWords(words: readonly string[], studied: readonly string[]): string[] {
  const norm = (w: string) => w.normalize('NFC').toLocaleLowerCase().trim();
  const known = new Set(studied.flatMap((t) => [norm(t), ...norm(t).split(/[^\p{L}\p{N}]+/u)]).filter(Boolean));
  return words.filter((w) => !known.has(norm(w)));
}

// ==== Skill cards in the collection ====

/**
 * Skill cards are Basic notes (Front, Back) in a `<deck>::Skills` subdeck, told apart by their tags:
 * `skill`, the group or drill step (`skill::drill::time-hours`, `skill::consonants`) and the language
 * (`skill::lang::th`). A note type of their own would need a full upload of the collection, since the
 * phone never sends note types; Basic is in every Anki collection, and Anki on the computer shows the
 * card as it is written here.
 */
export const SKILL_TAG = 'skill';
export const SKILL_NOTE_TYPE = 'Basic';
export const SKILLS_SUBDECK = 'Skills';

export type SkillGroup = DrillGroup | 'consonants' | 'vowels' | 'cases' | 'classifiers';

/** The languages that count with a classifier or counter, and what it's called. */
const CLASSIFIER_NAMES: Partial<Record<Language, { one: string; title: string }>> = { th: { one: 'classifier', title: 'Classifiers' }, ja: { one: 'counter', title: 'Counters' } };

export interface SkillGroupInfo {
  id: SkillGroup;
  title: string;
  /** What adding it puts in the deck, in a line. */
  detail: string;
  /** How many cards it adds. */
  count: number;
}

/** The language a deck is in, read from its name as Review reads a card's (`speechLangFor`), with its name; undefined when the name doesn't give one. */
export function languageOfDeck(deck: string): { language: Language; name: string } | undefined {
  const speech = speechLangFor({ id: '', deck, model: '', fields: {}, tags: [] });
  const language = LANGUAGE_ORDER.find((l) => LANGUAGES[l].speech === speech);
  return language ? { language, name: LANGUAGES[language].name } : undefined;
}

/** The groups a language has, in the order they're offered. */
export function skillGroups(language: Language): SkillGroupInfo[] {
  const out: SkillGroupInfo[] = [];
  const steps = (ladder: DrillStep[]) => ladder.map((s) => s.title.charAt(0).toLowerCase() + s.title.slice(1)).join(', ');
  if (hasDrills('time', language)) out.push({ id: 'time', title: GROUP_TITLES.time, detail: `${TIME_STEPS.length} drill cards: ${steps(TIME_STEPS)}`, count: TIME_STEPS.length });
  if (hasDrills('numbers', language)) out.push({ id: 'numbers', title: GROUP_TITLES.numbers, detail: `${NUMBER_STEPS.length} drill cards: ${steps(NUMBER_STEPS)}`, count: NUMBER_STEPS.length });
  if (hasDrills('dates', language)) out.push({ id: 'dates', title: GROUP_TITLES.dates, detail: `${DATE_STEPS.length} drill cards: ${steps(DATE_STEPS)}`, count: DATE_STEPS.length });
  if (hasDrills('money', language)) out.push({ id: 'money', title: GROUP_TITLES.money, detail: `${MONEY_STEPS.length} drill cards: ${steps(MONEY_STEPS)}`, count: MONEY_STEPS.length });
  if (language === 'th') {
    out.push({ id: 'consonants', title: 'Consonant classes', detail: `${CONSONANTS.length} cards, one per consonant`, count: CONSONANTS.length });
    out.push({ id: 'vowels', title: 'Vowel length', detail: `${VOWELS.length} cards, one per vowel`, count: VOWELS.length });
  }
  const counting = COUNTING[language];
  const cls = CLASSIFIER_NAMES[language];
  if (counting && cls) out.push({ id: 'classifiers', title: cls.title, detail: `${counting.nouns.length} cards, one per noun, asking its ${cls.one}`, count: counting.nouns.length });
  const cases = CASE_LANGUAGES[language];
  if (cases) out.push({ id: 'cases', title: 'Which case', detail: `${cases.governors.length} cards, one per preposition or verb`, count: cases.governors.length });
  return out;
}

export interface SkillDraft {
  fields: { Front: string; Back: string };
  tags: string[];
  /** Added suspended: a drill step whose step before hasn't settled yet. */
  suspended: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The notes adding `groups` in `language` writes, in order. */
export function skillDrafts(language: Language, languageName: string, groups: SkillGroup[]): SkillDraft[] {
  const lang = `${SKILL_TAG}::lang::${language}`;
  const drafts: SkillDraft[] = [];
  for (const group of groups) {
    if (group === 'consonants') {
      if (language !== 'th') continue;
      for (const c of CONSONANTS) {
        drafts.push({
          fields: {
            Front: `<div style="font-size:64px">${esc(c.letter)}</div><div>Which class?</div>`,
            Back: `<div><b>${CLASS_NAMES[c.cls]} class</b></div><div>${esc(c.name)} · ${esc(c.word)}, ${esc(c.meaning)}</div>`,
          },
          tags: [SKILL_TAG, `${SKILL_TAG}::consonants`, lang],
          suspended: false,
        });
      }
      continue;
    }
    if (group === 'vowels') {
      if (language !== 'th') continue;
      for (const v of VOWELS) {
        const [sound, ...why] = vowelSteps(v);
        drafts.push({
          fields: {
            Front: `<div style="font-size:64px">${esc(v.shown)}</div><div>Short or long?</div>`,
            Back: `<div><b>${v.long ? 'Long' : 'Short'}</b></div><div>${esc(vowelSyllable(v))} · ${esc(sound)}</div>${why.length ? `<div>${esc(why.join(' '))}</div>` : ''}`,
          },
          tags: [SKILL_TAG, `${SKILL_TAG}::vowels`, lang],
          suspended: false,
        });
      }
      continue;
    }
    if (group === 'classifiers') {
      const counting = COUNTING[language];
      const cls = CLASSIFIER_NAMES[language];
      if (!counting || !cls) continue;
      counting.nouns.forEach((noun, i) => {
        const said = counting.say(i, 3).everyday;
        const rule = counting.rule(i, 3);
        drafts.push({
          fields: {
            Front: `<div style="font-size:40px">${esc(noun.cue.text)}</div>${noun.cue.roman ? `<div>${esc(noun.cue.roman)}</div>` : ''}<div>${esc(noun.meaning)}</div><div>Which ${cls.one}? Say three of them.</div>`,
            Back: `<div><b>${esc(said.text)}</b></div>${said.roman ? `<div>${esc(said.roman)}</div>` : ''}${rule ? `<div>${esc(rule)}</div>` : ''}`,
          },
          tags: [SKILL_TAG, `${SKILL_TAG}::classifiers`, lang],
          suspended: false,
        });
      });
      continue;
    }
    if (group === 'cases') {
      const cases = CASE_LANGUAGES[language];
      if (!cases) continue;
      for (const g of cases.governors) {
        drafts.push({
          fields: {
            Front: `<div style="font-size:40px"><b>${esc(governorId(g))}</b></div><div>${esc(g.meaning)}</div><div>Which case comes after it?</div>`,
            Back: `<div><b>${esc(caseName(g.case))}</b></div><div>${esc(caseRule(cases, g))}</div>`,
          },
          tags: [SKILL_TAG, `${SKILL_TAG}::cases`, lang],
          suspended: false,
        });
      }
      continue;
    }
    if (!hasDrills(group, language)) continue;
    for (const step of DRILL_STEPS.filter((s) => s.group === group)) {
      drafts.push({
        fields: {
          // The language leads, so the same step for two languages isn't the same first field.
          Front: `<div><b>${esc(languageName)} · ${esc(GROUP_TITLES[group])}: ${esc(step.title)}</b></div><div>${esc(step.selfCheck)}</div>`,
          Back: '<div>Rate how it went. In Franki this card is a short drill.</div>',
        },
        tags: [SKILL_TAG, `${SKILL_TAG}::drill::${step.id}`, lang],
        suspended: !!step.after,
      });
    }
  }
  return drafts;
}

/** The drill a note's tags make it, with its language; undefined for any other note. */
export function drillOfTags(tags: readonly string[]): { step: DrillStep; language: Language } | undefined {
  if (!tags.includes(SKILL_TAG)) return undefined;
  const step = tags.map((t) => t.startsWith(`${SKILL_TAG}::drill::`) ? drillStep(t.slice(`${SKILL_TAG}::drill::`.length)) : undefined).find(Boolean);
  const language = tags.map((t) => t.startsWith(`${SKILL_TAG}::lang::`) ? t.slice(`${SKILL_TAG}::lang::`.length) : undefined)
    .find((l): l is Language => !!l && (LANGUAGE_ORDER as string[]).includes(l));
  return step && language ? { step, language } : undefined;
}

/** A skill card's place for releasing the next step: its drill step and language, whether it's suspended, and whether it has settled. */
export interface SkillCardState {
  id: string;
  stepId: string;
  language: Language;
  suspended: boolean;
  /** Started and scheduled a week or more out (the progress gate's line, src/core/progress.ts). */
  settled: boolean;
  /** The words its step waits for that the deck hasn't got yet (`stepWords`, `missingWords`). */
  missing?: readonly string[];
}

/** The suspended cards to release: those whose step before, in the same language, has settled, and whose words the deck has. */
export function releasable(cards: readonly SkillCardState[]): string[] {
  const settled = new Set(cards.filter((c) => c.settled).map((c) => `${c.language}|${c.stepId}`));
  return cards.filter((c) => {
    if (!c.suspended || c.missing?.length) return false;
    const after = drillStep(c.stepId)?.after;
    return !!after && settled.has(`${c.language}|${after}`);
  }).map((c) => c.id);
}

// ==== Progress ====

/** A skill card as Skills needs it, read off the card where it's shown. */
export interface SkillCardInfo {
  tags: readonly string[];
  suspended: boolean;
  /** Answered at least once. */
  started: boolean;
  /** Its next review a week or more out (the progress gate's line). */
  settled: boolean;
  /** Study days until it's due: 0 today, negative overdue. */
  dueInDays: number;
  /** FSRS's chance of recall now, in percent; undefined before its first review. */
  percent?: number;
  /** The words its step still waits for in the deck. */
  missing?: readonly string[];
}

export interface SkillRow { title: string; detail: string; meter?: number; locked: boolean }
export interface SkillSection { title: string; rows: SkillRow[] }

const due = (days: number) => (days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Next in ${days} days`);

/** What Skills shows for a deck's skill cards: each drill step in ladder order, and a set of single cards as how many have settled. */
export function skillSections(cards: readonly SkillCardInfo[]): SkillSection[] {
  const sections: SkillSection[] = [];
  for (const group of ['time', 'numbers', 'dates', 'money'] as DrillGroup[]) {
    const rows = DRILL_STEPS.filter((s) => s.group === group).flatMap((step): SkillRow[] => {
      const card = cards.find((c) => c.tags.includes(`${SKILL_TAG}::drill::${step.id}`));
      if (!card) return [];
      const before = step.after ? drillStep(step.after)?.title : undefined;
      if (card.suspended && card.missing?.length) return [{ title: step.title, detail: `Waiting for ${card.missing.join(', ')} in your deck`, locked: true }];
      if (card.suspended) return [{ title: step.title, detail: before ? `Comes in after ${before.charAt(0).toLowerCase() + before.slice(1)} settles` : 'Suspended', locked: true }];
      if (!card.started) return [{ title: step.title, detail: 'Not started yet', locked: false }];
      return [{ title: step.title, detail: due(card.dueInDays), meter: card.percent, locked: false }];
    });
    if (rows.length) sections.push({ title: GROUP_TITLES[group], rows });
  }
  const sets: { section: string; tag: string; title: string }[] = [
    { section: 'Letters', tag: 'consonants', title: 'Consonant classes' },
    { section: 'Letters', tag: 'vowels', title: 'Vowel length' },
    { section: 'Grammar', tag: 'classifiers', title: 'Classifiers and counters' },
    { section: 'Grammar', tag: 'cases', title: 'Which case' },
  ];
  for (const set of sets) {
    const of = cards.filter((c) => c.tags.includes(`${SKILL_TAG}::${set.tag}`));
    if (!of.length) continue;
    const settled = of.filter((c) => c.settled).length;
    const fresh = of.filter((c) => !c.started).length;
    const row: SkillRow = { title: set.title, detail: `${settled} of ${of.length} settled${fresh ? ` · ${fresh} not started` : ''}`, meter: Math.round((settled / of.length) * 100), locked: false };
    const into = sections.find((x) => x.title === set.section);
    if (into) into.rows.push(row); else sections.push({ title: set.section, rows: [row] });
  }
  return sections;
}

/** Whether to offer skill cards at the end of a session in `deck`: its language has some, and the deck has none yet. The language's name, or undefined. */
export function skillOffer(deck: string, notes: Iterable<{ deck: string; tags: readonly string[] }>): string | undefined {
  const found = languageOfDeck(deck);
  if (!found || !skillGroups(found.language).length) return undefined;
  for (const n of notes) if (n.tags.includes(SKILL_TAG) && (n.deck === deck || n.deck.startsWith(`${deck}::`))) return undefined;
  return found.name;
}

/** The headwords of the notes studied (a card past new), skill cards left out: what `missingWords` checks a step's words against. */
export function studiedHeadwords(notes: Iterable<Note>, cards: Iterable<{ noteId: string; sched: { state: number }; retired?: boolean }>): string[] {
  const started = new Set<string>();
  for (const c of cards) if (c.sched.state !== 0 && !c.retired) started.add(c.noteId);
  const out: string[] = [];
  for (const n of notes) if (started.has(n.id) && !n.tags.includes(SKILL_TAG)) out.push(headword(n));
  return out;
}

/** What each skill card's step still waits for, by card id, given the deck's studied headwords. */
export function missingByCard(cards: Iterable<{ id: string; noteId: string }>, notes: Map<string, Note>, studied: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of cards) {
    const n = notes.get(c.noteId);
    const drill = n && drillOfTags(n.tags);
    if (!drill) continue;
    const missing = missingWords(stepWords(drill.step.id, drill.language), studied);
    if (missing.length) out.set(c.id, missing);
  }
  return out;
}
