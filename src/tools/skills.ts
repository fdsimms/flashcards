import type { Language } from '../reader/api';
import { speechLangFor } from '../core/cards';
import { isInDeck } from '../core/deckTree';
import { headword } from '../core/forms';
import { setAsideOf, SKILL_DRILL_TAG, SKILL_TAG, SKILLS_SUBDECK, type SetAside } from '../core/skillTag';
import { isSettled } from '../core/progress';
import type { Card, Note } from '../core/types';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import type { NumberQuestion, NumberSaying } from './number';
import type { Phrase } from './phrase';
import { pickOther } from './random';
import { clockText, randomTime, type ClockTime, type MinuteStep, type TimeSaying } from './time';
import { CASE_LANGUAGES, caseName, caseRule, governorId } from './cases';
import { randomDate, weekdayOf, type CalendarDate, type DateParts, type DateScope } from './date';
import { CURRENCIES, randomAmount, type MoneyMax } from './money';
import { CLASS_COLORS, CLASS_NAMES, CONSONANTS, VOWELS, vowelSteps, vowelSyllable } from './thai/letters';
import { drawUnseen } from './drillSeen';
import { stepNeeds, stillNeeded, wordDrafts, type SkillWordDraft } from './skillWords';
import { countEnding, type CountQuestion } from './counting';
import { COUNTING, CURRENCY_OF, DATE_SAYERS, MONEY_SAYERS, NUMBER_SAYERS, TIME_SAYERS } from './tools';
import { CONTRAST_SETS, CONTRAST_STEP_PREFIX, GAP_SHOWN, contrastKey, contrastSet, contrastTitle, drawSentence, showSentence, type ContrastQuestion } from './contrasts';

/**
 * Skill cards' drills: a skill with endless questions (any time, any number) as a ladder of steps,
 * each of which becomes one card in the collection. When the card comes up, its drill asks a few
 * questions drawn from the step (here), and the rating the learner taps for the card schedules the
 * skill. Nothing here rates, schedules or writes a card: `suggestedRating` only says which button to
 * outline (src/ui/tools/SkillDrill.tsx), and the learner's tap is what reaches FSRS.
 */

export type DrillGroup = 'time' | 'numbers' | 'dates' | 'money' | 'counting' | 'contrast';

export interface DrillStep {
  /** Stable across versions: it's written into the card (`SkillId`) and read back to find the drill. */
  id: string;
  group: DrillGroup;
  title: string;
  /** The step before, which settles first: this one is added suspended and released after it. */
  after?: string;
  /**
   * Asks everything every earlier step of its ladder asks (any minute takes in the hour and the quarters;
   * a date with the weekday is the day and month with one more word), so once it has settled the earlier
   * ones are set aside (`coverable`) and a week's practice is one card, not the whole ladder.
   */
  coversEarlier?: true;
  /** What Anki on the computer shows, where there's no drill: something to do without the app, then rate. */
  selfCheck: string;
}

interface TimeStep extends DrillStep { group: 'time'; minutes: 'hours' | 'quarters' | MinuteStep }
interface NumberStep extends DrillStep { group: 'numbers'; min: number; max: number }
interface DateStep extends DrillStep { group: 'dates'; parts: DateParts }
interface MoneyStep extends DrillStep { group: 'money'; max: MoneyMax }
/** `ending` is which numbers the step draws: one noun form each, or any number to 100 (the last digits then decide the form). */
interface CountStep extends DrillStep { group: 'counting'; ending: 'one' | 'few' | 'many' | 'any' }
/** One set of Which word fits (contrasts.ts): its own language, and a card of its own, waiting for the set's words. */
export interface ContrastStep extends DrillStep { group: 'contrast'; language: Language; set: string }

export const TIME_STEPS: TimeStep[] = [
  { id: 'time-hours', group: 'time', title: "O'clock and half past", minutes: 'hours', selfCheck: 'Say three times aloud: one on the hour, one at half past, one in the evening.' },
  { id: 'time-quarters', group: 'time', title: 'Quarter past and to', minutes: 'quarters', after: 'time-hours', selfCheck: 'Say three times aloud at a quarter past or a quarter to the hour, morning and afternoon.' },
  { id: 'time-five', coversEarlier: true, group: 'time', title: 'Five-minute steps', minutes: 5, after: 'time-quarters', selfCheck: 'Say three times aloud on five-minute steps, such as 10:25 or 16:50.' },
  { id: 'time-any', coversEarlier: true, group: 'time', title: 'Any minute', minutes: 1, after: 'time-five', selfCheck: 'Say three times aloud at any minute, such as 07:13 or 21:48.' },
];

export const NUMBER_STEPS: NumberStep[] = [
  { id: 'numbers-10', group: 'numbers', title: '1 to 10', min: 1, max: 10, selfCheck: 'Count from 1 to 10 aloud, then say 3, 7 and 9 on their own.' },
  { id: 'numbers-99', group: 'numbers', title: '11 to 99', min: 11, max: 99, after: 'numbers-10', selfCheck: 'Say three numbers between 11 and 99 aloud, such as 17, 40 and 85.' },
  { id: 'numbers-999', group: 'numbers', title: 'Hundreds', min: 100, max: 999, after: 'numbers-99', selfCheck: 'Say three numbers between 100 and 999 aloud, such as 105, 360 and 999.' },
  { id: 'numbers-big', group: 'numbers', title: 'Thousands and up', min: 1000, max: 999_999, after: 'numbers-999', selfCheck: 'Say three numbers in the thousands aloud, such as 2,400, 15,031 and 680,000.' },
];

export const DATE_STEPS: DateStep[] = [
  { id: 'dates-day', group: 'dates', title: 'Day and month', parts: { weekday: false, year: false }, selfCheck: "Say today's date aloud, then your birthday, then the first of next month." },
  { id: 'dates-weekday', coversEarlier: true, group: 'dates', title: 'With the weekday', parts: { weekday: true, year: false }, after: 'dates-day', selfCheck: "Say today's date aloud with its weekday, then the same for a week from now." },
  { id: 'dates-year', coversEarlier: true, group: 'dates', title: 'With the weekday and year', parts: { weekday: true, year: true }, after: 'dates-weekday', selfCheck: 'Say aloud the full date of today, of your birthday this year, and of New Year\'s Day.' },
];

export const MONEY_STEPS: MoneyStep[] = [
  { id: 'money-100', group: 'money', title: 'Prices up to 100', max: 100, selfCheck: 'Say three small prices aloud, such as a coffee, a snack and a bus fare.' },
  { id: 'money-1000', coversEarlier: true, group: 'money', title: 'Prices up to 1,000', max: 1000, after: 'money-100', selfCheck: 'Say three prices up to 1,000 aloud, such as a meal, a shirt and a taxi.' },
  { id: 'money-10000', coversEarlier: true, group: 'money', title: 'Prices up to 10,000', max: 10000, after: 'money-1000', selfCheck: 'Say three prices up to 10,000 aloud, such as a phone, a flight and a month\'s rent.' },
];

/** Polish and Russian: the noun's form follows the number (dwa koty, pięć kotów; два кота, пять котов), one form per step. */
export const COUNT_STEPS: CountStep[] = [
  { id: 'counting-one', group: 'counting', title: '1 with the noun', ending: 'one', selfCheck: 'Say 1 with three nouns aloud, one of each gender, such as a cat, a book and an apple.' },
  { id: 'counting-few', group: 'counting', title: '2 to 4', ending: 'few', after: 'counting-one', selfCheck: 'Say 2, 3 and 4 with a noun aloud, and 2 with a feminine noun.' },
  { id: 'counting-many', group: 'counting', title: '5 and up', ending: 'many', after: 'counting-few', selfCheck: 'Say 5, 11 and 20 with a noun aloud.' },
  { id: 'counting-any', coversEarlier: true, group: 'counting', title: 'Any number to 100', ending: 'any', after: 'counting-many', selfCheck: 'Say 21, 22 and 25 with a noun aloud, then any other number to 100.' },
];

/** Which word fits: a step per set, in each language's own order. The id leads with `contrast-`, then the set's (which leads with its language). */
export const CONTRAST_STEPS: ContrastStep[] = (Object.entries(CONTRAST_SETS) as [Language, NonNullable<(typeof CONTRAST_SETS)[Language]>][]).flatMap(([language, sets]) => sets.map((set): ContrastStep => ({
  id: `${CONTRAST_STEP_PREFIX}${set.id}`,
  group: 'contrast',
  language,
  set: set.id,
  title: contrastTitle(set),
  selfCheck: 'Say a sentence aloud with each word, then check it against the rules on the back.',
})));

export const DRILL_STEPS: DrillStep[] = [...TIME_STEPS, ...NUMBER_STEPS, ...DATE_STEPS, ...MONEY_STEPS, ...COUNT_STEPS, ...CONTRAST_STEPS];

/** Whether `step` is asked in `language`: every step is, but a Which word fits set only in its own. */
export const stepIn = (step: DrillStep, language: Language): boolean => step.group !== 'contrast' || (step as ContrastStep).language === language;

export const GROUP_TITLES: Record<DrillGroup, string> = { time: 'Telling the time', numbers: 'Numbers', dates: 'Saying dates', money: 'Counting money', counting: 'Counting things', contrast: 'Which word fits' };

export const drillStep = (id: string): DrillStep | undefined => DRILL_STEPS.find((s) => s.id === id);

/** Whether the language has the drills of a group (a saying for each question). */
/** The languages whose noun changes form with the number: the others' counting is a classifier or a plural to know, not a ladder. */
const COUNT_LADDER_LANGUAGES: readonly Language[] = ['pl', 'ru'];

export function hasDrills(group: DrillGroup, language: Language): boolean {
  if (group === 'time') return !!TIME_SAYERS[language];
  if (group === 'numbers') return !!NUMBER_SAYERS[language];
  if (group === 'dates') return !!DATE_SAYERS[language];
  if (group === 'counting') return COUNT_LADDER_LANGUAGES.includes(language) && !!COUNTING[language];
  if (group === 'contrast') return !!CONTRAST_SETS[language]?.length;
  return !!MONEY_SAYERS[language] && !!CURRENCY_OF[language];
}

/** How many questions a drill asks before the card is rated. */
export const DRILL_QUESTIONS = 3;

export type DrillQuestion =
  | { kind: 'time'; time: ClockTime }
  | { kind: 'number'; question: NumberQuestion }
  | { kind: 'date'; date: CalendarDate; parts: DateParts }
  | { kind: 'money'; amount: number }
  | { kind: 'count'; question: CountQuestion }
  | ({ kind: 'contrast' } & ContrastQuestion);

/** A question's key, so the same one isn't asked twice in a row. */
export function questionKey(q: DrillQuestion): string {
  switch (q.kind) {
    case 'time': return clockText(q.time);
    case 'number': return String(q.question.kind === 'phone' ? q.question.written : q.question.n);
    case 'date': return `${q.date.year}-${q.date.month}-${q.date.day}`;
    case 'money': return String(q.amount);
    case 'count': return `${q.question.noun}:${q.question.n}`;
    case 'contrast': return contrastKey(q);
  }
}

/** Whether `n` is in a counting step's range: 1 alone (21 and 31 are in Any number), 2 to 4 (and 22 to 24...), or the rest (5 to 20, 25 to 30...). */
const countStepFits = (ending: CountStep['ending'], n: number): boolean => {
  if (ending === 'any') return true;
  if (ending === 'one') return n === 1;
  const e = countEnding(n);
  return ending === 'few' ? e === '2-4' : e === 'many' || e === 'teen';
};

/** A count for a counting step: a noun and a number from its range, never `previous` again. */
function drawCount(step: CountStep, previous: CountQuestion | undefined, random: () => number, language: Language | undefined): CountQuestion {
  const nouns = COUNTING[language && COUNT_LADDER_LANGUAGES.includes(language) ? language : 'pl']?.nouns.length ?? 1;
  const pool = Array.from({ length: 100 }, (_, i) => i + 1).filter((n) => countStepFits(step.ending, n));
  const at = previous && previous.noun < nouns ? pool.indexOf(previous.n) : -1;
  const i = pickOther(nouns * pool.length, at >= 0 ? previous!.noun * pool.length + at : undefined, random);
  return { noun: Math.floor(i / pool.length), n: pool[i % pool.length] };
}

/**
 * A question for `step` in `language`, never `previous` again, and one not in `recent` (the keys the step
 * asked lately, drillSeen.ts) while the step has others. `only` limits a date to the months and days the learner knows.
 */
export function drawQuestion(step: DrillStep, previous?: DrillQuestion, random: () => number = Math.random, language?: Language, only?: DateScope, recent?: readonly string[]): DrillQuestion {
  return drawUnseen(() => drawOnce(step, previous, random, language, only), questionKey, recent);
}

function drawOnce(step: DrillStep, previous: DrillQuestion | undefined, random: () => number, language: Language | undefined, only: DateScope | undefined): DrillQuestion {
  if (step.group === 'contrast') {
    const s = step as ContrastStep;
    const set = contrastSet(s.set)?.set;
    const last = previous?.kind === 'contrast' && previous.setId === s.set ? previous.index : undefined;
    return { kind: 'contrast', setId: s.set, index: set ? drawSentence(set, last, random) : 0 };
  }
  if (step.group === 'dates') {
    const s = step as DateStep;
    return { kind: 'date', date: randomDate(previous?.kind === 'date' ? previous.date : undefined, random, only), parts: s.parts };
  }
  if (step.group === 'money') {
    const s = step as MoneyStep;
    const currency = CURRENCIES[(language && CURRENCY_OF[language]) || 'EUR'];
    return { kind: 'money', amount: randomAmount(currency, s.max, previous?.kind === 'money' ? previous.amount : undefined, random) };
  }
  if (step.group === 'counting') {
    const s = step as CountStep;
    return { kind: 'count', question: drawCount(s, previous?.kind === 'count' ? previous.question : undefined, random, language) };
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
 * A card's round for one study day: `DRILL_QUESTIONS` questions from `step`, none the one before it and
 * none that `recent` (what the step asked lately, drillSeen.ts) holds while the step has others. The
 * round is drawn once and kept (drillRound.ts), so it is the same every time the card comes up that day.
 * A dates round picks each question's month first (`nextMonth`), from `missedMonths` among others.
 */
export function drawRound(step: DrillStep, random: () => number = Math.random, language?: Language, only?: DateScope, recent: readonly string[] = [], missedMonths: readonly number[] = []): DrillQuestion[] {
  const round: DrillQuestion[] = [];
  for (let i = 0; i < DRILL_QUESTIONS; i++) {
    // The round's own questions count as asked, so a small step doesn't repeat one within the round.
    const asked = [...recent, ...round.map(questionKey)];
    const months = only?.months?.length ? only.months : ALL_MONTHS;
    const scope = step.group === 'dates' ? { ...only, months: [nextMonth(months, asked, missedMonths.filter((m) => !round.some((q) => q.kind === 'date' && q.date.month === m)), random)] } : only;
    round.push(drawQuestion(step, round[i - 1], random, language, scope, asked));
  }
  return round;
}

const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The month (1 to 12) of a dates drill's question key (`questionKey`: year-month-day), or undefined for any other key. */
const monthOfKey = (key: string): number | undefined => {
  const m = /^\d+-(\d+)-\d+$/.exec(key);
  return m ? Number(m[1]) : undefined;
};

/**
 * The month a dates drill asks about next, of the `months` the deck knows: one the step hasn't asked
 * lately (a month just learned comes first, rather than waiting for chance to draw it), then one missed
 * lately (`missed`, oldest miss first), then the one asked longest ago. So every known month comes round
 * in turn, which a few random questions a week didn't do. `recent` is the step's asked keys, least recent first.
 */
export function nextMonth(months: readonly number[], recent: readonly string[], missed: readonly number[], random: () => number = Math.random): number {
  const lastAsked = new Map<number, number>();
  recent.forEach((k, i) => { const m = monthOfKey(k); if (m !== undefined) lastAsked.set(m, i); });
  const fresh = months.filter((m) => !lastAsked.has(m));
  if (fresh.length) return fresh[Math.floor(random() * fresh.length)];
  const miss = missed.find((m) => months.includes(m));
  if (miss !== undefined) return miss;
  return [...months].sort((a, b) => lastAsked.get(a)! - lastAsked.get(b)!)[0];
}

/** The questions a card asks when it returns the same day: the ones missed, kept after Again or Hard and dropped after Good or Easy. */
export function missesToCarry(rating: number, missed: readonly DrillQuestion[]): DrillQuestion[] {
  return rating <= 2 ? [...missed] : [];
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
    case 'count': return `${q.question.n} ${(language && COUNTING[language]?.nouns[q.question.noun]?.cue.text) ?? ''}`.trim();
    case 'contrast': {
      const found = contrastSet(q.setId);
      const shown = found && showSentence(found.set, q.index, found.language);
      return shown ? `${shown.before}${GAP_SHOWN}${shown.after}` : '';
    }
  }
}

/** What goes under a count question: its noun's reading where the language has one, and its meaning in English. Nothing for the other questions. */
export function questionNote(q: DrillQuestion, language?: Language): string | undefined {
  if (q.kind !== 'count') return undefined;
  const noun = language && COUNTING[language]?.nouns[q.question.noun];
  return noun ? [noun.cue.roman, noun.meaning].filter(Boolean).join(' · ') : undefined;
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
  if (q.kind === 'contrast') {
    const found = contrastSet(q.setId);
    const shown = found && showSentence(found.set, q.index, found.language);
    return shown && { everyday: { text: shown.filled, roman: shown.roman }, also: [], last: { title: shown.answer.word, phrase: { text: shown.answer.rule } } };
  }
  if (q.kind === 'count') {
    const counting = COUNTING[language];
    if (!counting) return undefined;
    const said = counting.say(q.question.noun, q.question.n);
    const rule = counting.rule(q.question.noun, q.question.n);
    return { everyday: said.everyday, also: said.also, ...(rule ? { last: { title: 'Rule', phrase: { text: rule } } } : {}) };
  }
  const s: NumberSaying | undefined = NUMBER_SAYERS[language]?.(q.question);
  return s && { everyday: s.everyday, also: s.also };
}

/**
 * The rating to suggest once a drill is done, as a button's number (1 Again, 2 Hard, 3 Good): all
 * right is Good, one miss Hard, more Again. Only a suggestion: the learner taps the rating, and
 * Easy is theirs to choose. With Hard turned off (`hardShown` false) it must name a button that
 * is there: one miss is Again (Hard would tell FSRS it was remembered), and right but slow is Good.
 */
export function suggestedRating(results: readonly boolean[], thinkMs: readonly number[] = [], group?: DrillGroup, hardShown = true): 1 | 2 | 3 {
  const missed = results.filter((r) => !r).length;
  // One miss is Hard only when something else was right: a single question missed is Again.
  if (missed) return missed === 1 && results.length > 1 && hardShown ? 2 : 1;
  return group && hardShown && isSlow(thinkMs, group) ? 2 : 3;
}

/**
 * How long answering may take, per question, before an all-right drill counts as slow: telling the
 * time or a price is about speed as much as being right, so a right answer worked out slowly is Hard.
 * The time is from the question coming up to Show answer, or to the end of speaking it.
 */
export const SLOW_MS: Record<DrillGroup, number> = { time: 6000, numbers: 5000, dates: 9000, money: 7000, counting: 6000, contrast: 12000 };

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
    // A count is said with its noun; the recognizer may write the number as digits before it (see `heardRight`).
    case 'count': return [];
    case 'contrast': return [];
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
  // "5 kotów": the number as digits, then the noun as the answer ends with it.
  if (q.kind === 'count' && answer && squeezed(`${q.question.n}${answer.everyday.text.split(' ').pop()}`) === said) return true;
  const digits = heard.replace(/\D/g, '');
  return !!digits && digits === heard.replace(/[^\d\p{L}]/gu, '') && questionDigits(q).includes(digits);
}

// ==== Waiting for vocabulary ====

/** Whether a step is added suspended and released later: it comes after another step, or waits for words. */
export const stepWaits = (step: DrillStep, language: Language): boolean => !!step.after || stepNeeds(step.id, language).length > 0;

// ==== Skill cards in the collection ====

/**
 * Skill cards are Basic notes (Front, Back) in a `<deck>::Skills` subdeck, told apart by their tags:
 * `skill`, the group or drill step (`skill::drill::time-hours`, `skill::consonants`) and the language
 * (`skill::lang::th`). A note type of their own would need a full upload of the collection, since the
 * phone never sends note types; Basic is in every Anki collection, and Anki on the computer shows the
 * card as it is written here.
 */
export { SKILL_TAG };
export const SKILL_NOTE_TYPE = 'Basic';
export { SKILLS_SUBDECK };

export type SkillGroup = DrillGroup | 'consonants' | 'vowels' | 'cases' | 'classifiers';

/** Every skill group, for reading a saved list of them back (src/anki/skillSettings.ts) without trusting it. */
export const SKILL_GROUP_IDS: readonly SkillGroup[] = ['time', 'numbers', 'dates', 'money', 'counting', 'consonants', 'vowels', 'cases', 'classifiers', 'contrast'];

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
  if (hasDrills('counting', language)) out.push({ id: 'counting', title: GROUP_TITLES.counting, detail: `${COUNT_STEPS.length} drill cards: ${steps(COUNT_STEPS)}`, count: COUNT_STEPS.length });
  if (language === 'th') {
    out.push({ id: 'consonants', title: 'Consonant classes', detail: `${CONSONANTS.length} cards, one per consonant`, count: CONSONANTS.length });
    out.push({ id: 'vowels', title: 'Vowel length', detail: `${VOWELS.length} cards, one per vowel`, count: VOWELS.length });
  }
  const counting = COUNTING[language];
  const cls = CLASSIFIER_NAMES[language];
  if (counting && cls) out.push({ id: 'classifiers', title: cls.title, detail: `${counting.nouns.length} cards, one per noun, asking its ${cls.one}`, count: counting.nouns.length });
  const cases = CASE_LANGUAGES[language];
  if (cases) out.push({ id: 'cases', title: 'Which case', detail: `${cases.governors.length} cards, one per preposition or verb`, count: cases.governors.length });
  const contrasts = CONTRAST_STEPS.filter((s) => s.language === language);
  if (contrasts.length) out.push({ id: 'contrast', title: GROUP_TITLES.contrast, detail: `${contrasts.length} cards, one per set of words easily mixed up`, count: contrasts.length });
  return out;
}

export interface SkillDraft {
  fields: { Front: string; Back: string };
  tags: string[];
  /** Added suspended: a drill step whose step before hasn't settled yet. */
  suspended: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A Thai play button: the phone's voice reads `text` (Anki's [anki:tts], so Anki on a computer reads it too). */
const thaiSpeech = (text: string) => `<div>[anki:tts lang=th_TH]${esc(text)}[/anki:tts]</div>`;

/**
 * A skill card's Front with its [anki:tts] tags taken out: how a card counts as already added
 * (`haveFronts`, and skills.py's `_have_fronts`), so audio added to a card later never makes the
 * deck's existing cards look missing and written a second time.
 */
export const skillFrontKey = (front: string): string => front.replace(/<div>\[anki:tts[^\]]*\][\s\S]*?\[\/anki:tts\]<\/div>/g, '');

/** A Which word fits card's back on Anki on the computer, where there's no drill: each word's rule, to check a sentence against. Nothing for another step. */
function contrastRules(step: DrillStep): string {
  if (step.group !== 'contrast') return '';
  const set = contrastSet((step as ContrastStep).set)?.set;
  return set ? set.words.map((w) => `<div><b>${esc(w.word)}</b>${w.roman ? ` (${esc(w.roman)})` : ''}: ${esc(w.rule)}</div>`).join('') : '';
}

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
            Front: `<div style="font-size:64px">${esc(c.letter)}</div>${thaiSpeech(c.say)}<div>Which class?</div>`,
            Back: `<div><b style="color:${CLASS_COLORS[c.cls]}">● ${CLASS_NAMES[c.cls]} class</b></div><div>${esc(c.name)} · ${esc(c.word)}, ${esc(c.meaning)}</div>`,
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
            Back: `<div><b>${v.long ? 'Long' : 'Short'}</b></div><div>${esc(vowelSyllable(v))} · ${esc(sound)}</div>${thaiSpeech(v.example.text)}${why.length ? `<div>${esc(why.join(' '))}</div>` : ''}`,
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
    for (const step of DRILL_STEPS.filter((s) => s.group === group && stepIn(s, language))) {
      drafts.push({
        fields: {
          // The language leads, so the same step for two languages isn't the same first field.
          Front: `<div><b>${esc(languageName)} · ${esc(GROUP_TITLES[group])}: ${esc(step.title)}</b></div><div>${esc(step.selfCheck)}</div>`,
          Back: `${contrastRules(step)}<div>Rate how it went. In Franki this card is a short drill.</div>`,
        },
        tags: [SKILL_TAG, `${SKILL_DRILL_TAG}${step.id}`, lang],
        suspended: stepWaits(step, language),
      });
    }
  }
  return drafts;
}

/** The notes for the words the drill groups in `groups` need that the deck may lack (the months for dates, the number words for numbers...). The caller leaves out the ones it has. */
export function skillWordDrafts(language: Language, groups: SkillGroup[]): SkillWordDraft[] {
  return wordDrafts(language, groups.filter((g): g is DrillGroup => (g === 'time' || g === 'numbers' || g === 'dates' || g === 'money' || g === 'counting') && hasDrills(g, language)));
}

/** The drill a note's tags make it, with its language; undefined for any other note. */
export function drillOfTags(tags: readonly string[]): { step: DrillStep; language: Language } | undefined {
  if (!tags.includes(SKILL_TAG)) return undefined;
  const step = tags.map((t) => t.startsWith(SKILL_DRILL_TAG) ? drillStep(t.slice(SKILL_DRILL_TAG.length)) : undefined).find(Boolean);
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
  /** What its step waits for in the deck, said for a person (`stepNeeds`, `stillNeeded`). */
  missing?: readonly string[];
  /** The deck's skill cards are paused (Skill cards switched off): nothing is released or held back. */
  paused?: boolean;
  /** Stopped or covered (`setAsideOf`): it stays suspended whatever the ladder or its words say. */
  setAside?: SetAside;
}

/**
 * The suspended cards to release: a step whose step before, in the same language, has settled, or a
 * first step that waits only for words; either one only once the deck knows the words it needs.
 */
export function releasable(cards: readonly SkillCardState[]): string[] {
  const settled = new Set(cards.filter((c) => c.settled).map((c) => `${c.language}|${c.stepId}`));
  return cards.filter((c) => {
    if (!c.suspended || c.paused || c.setAside || c.missing?.length) return false;
    const step = drillStep(c.stepId);
    if (!step) return false;
    if (step.after) return settled.has(`${c.language}|${step.after}`);
    return stepNeeds(step.id, c.language).length > 0;
  }).map((c) => c.id);
}

/**
 * The live cards to hold back: a step that waits for words whose words the deck doesn't know yet, started
 * or not. A deck got its steps live before they waited for words (or while a word had only been seen), and
 * a learner can unsuspend one; holding it again keeps a drill from asking about words not known. Released
 * again by `releasable` once the words are known, so a step the learner suspended by hand while it waits
 * for words comes back then too: the pause switch is the way to stop a deck's skill cards.
 */
export function holdable(cards: readonly SkillCardState[]): string[] {
  return cards.filter((c) => !c.suspended && !c.paused && !c.setAside && !!c.missing?.length && stepNeeds(c.stepId, c.language).length > 0).map((c) => c.id);
}

/** The later steps of `stepId`'s ladder that ask everything it does (`coversEarlier`), nearest first. */
export function coveringSteps(stepId: string): DrillStep[] {
  const step = drillStep(stepId);
  if (!step) return [];
  const ladder = DRILL_STEPS.filter((s) => s.group === step.group);
  return ladder.slice(ladder.indexOf(step) + 1).filter((s) => s.coversEarlier);
}

/**
 * The cards to set aside as covered: a step a later one of its ladder covers, once that one has settled
 * in the same language. Set aside for good (`SKILL_COVERED_TAG`), not while the later step stays settled:
 * with drills reviewed weekly (`DRILL_MAX_INTERVAL_DAYS`) a Hard puts it back under the week, and the
 * earlier step would come and go with it. Nothing changes while the deck's skill cards are paused.
 */
export function coverable(cards: readonly SkillCardState[]): string[] {
  const settled = new Set(cards.filter((c) => c.settled).map((c) => `${c.language}|${c.stepId}`));
  return cards.filter((c) => !c.paused && !c.setAside && coveringSteps(c.stepId).some((s) => settled.has(`${c.language}|${s.id}`))).map((c) => c.id);
}

// ==== Clean weeks ====

/** How many clean weeks in a row before Review and Skill cards suggest stopping a step. */
export const STOP_SUGGESTED_AFTER = 6;

/** A review counts as a week's when it came at least this long after the answer before it (a week, less a day for a study day's drift). */
const WEEK_GAP_MS = 6 * 86_400_000;

/**
 * How many weeks running a drill card has been answered Good or Easy: its reviews newest first, each
 * counted when it came a week or so after the answer before it (an early review at a few days, while the
 * card was still climbing to the week, isn't a week). Any Again or Hard, or a learning or relearning
 * answer, ends the run. Answers made by hand (rating 0: Set Due Date, Forget) are passed over.
 */
export function cleanWeeks(history: readonly { at: Date; kind: string; rating: number }[]): number {
  const answers = history.filter((h) => h.rating > 0);
  let weeks = 0;
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (a.kind !== 'Review' || a.rating < 3) break;
    const before = answers[i + 1];
    if (before && a.at.getTime() - before.at.getTime() >= WEEK_GAP_MS) weeks++;
  }
  return weeks;
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
  /** Its note, for Stop practicing and Start again. */
  noteId?: string;
  /** Weeks running answered Good or Easy (`cleanWeeks`); a drill card's only. */
  weeks?: number;
}

export interface SkillRow {
  title: string;
  detail: string;
  meter?: number;
  locked: boolean;
  /** Set aside because a later step asks everything it did: shown done, with nothing to tap. */
  covered?: boolean;
  /** A run of clean weeks (`STOP_SUGGESTED_AFTER` or more): the detail says so in the good color. */
  clean?: boolean;
  /** What the row's button does to the step's note: stop practicing it, or start it again. */
  action?: { kind: 'stop' | 'start'; noteId: string };
}
export interface SkillSection { title: string; rows: SkillRow[] }

const due = (days: number) => (days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Next in ${days} days`);

/** What Skills shows for a deck's skill cards: each drill step in ladder order, and a set of single cards as how many have settled. */
export function skillSections(cards: readonly SkillCardInfo[]): SkillSection[] {
  const sections: SkillSection[] = [];
  for (const group of ['time', 'numbers', 'dates', 'money', 'counting', 'contrast'] as DrillGroup[]) {
    const rows = DRILL_STEPS.filter((s) => s.group === group).flatMap((step): SkillRow[] => {
      const card = cards.find((c) => c.tags.includes(`${SKILL_DRILL_TAG}${step.id}`));
      if (!card) return [];
      const before = step.after ? drillStep(step.after)?.title : undefined;
      const aside = setAsideOf(card.tags);
      if (aside === 'covered') {
        const by = coveringSteps(step.id).find((s) => cards.some((c) => c.settled && c.tags.includes(`${SKILL_DRILL_TAG}${s.id}`))) ?? coveringSteps(step.id)[0];
        return [{ title: step.title, detail: by ? `Covered by “${by.title}”` : 'Covered by a later step', locked: false, covered: true }];
      }
      if (aside === 'stopped') return [{ title: step.title, detail: 'Stopped', locked: false, ...(card.noteId ? { action: { kind: 'start' as const, noteId: card.noteId } } : {}) }];
      if (card.suspended && card.missing?.length) return [{ title: step.title, detail: `Starts once you know ${card.missing.join(', ')} well`, locked: true }];
      if (card.suspended) return [{ title: step.title, detail: before ? `Starts once you know ${before.charAt(0).toLowerCase() + before.slice(1)} well` : 'Suspended', locked: true }];
      if (!card.started) return [{ title: step.title, detail: 'Not started yet', locked: false }];
      if ((card.weeks ?? 0) >= STOP_SUGGESTED_AFTER && card.noteId) return [{ title: step.title, detail: `Right ${card.weeks} weeks in a row`, locked: false, clean: true, action: { kind: 'stop', noteId: card.noteId } }];
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
    const row: SkillRow = { title: set.title, detail: `${settled} of ${of.length} learned${fresh ? ` · ${fresh} not started` : ''}`, meter: Math.round((settled / of.length) * 100), locked: false };
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

/** The language deck a skill note's words are looked up in: the deck above its Skills subdeck, so a German "Juni" never counts as Norwegian's. */
export const skillLanguageDeck = (deck: string): string => (deck.endsWith(`::${SKILLS_SUBDECK}`) ? deck.slice(0, -(SKILLS_SUBDECK.length + 2)) : deck);

/** The cards `knownHeadwords` reads: a note's word is known when one of its cards has settled (`isSettled`). */
type KnownCard = { noteId: string; sched: Pick<Card['sched'], 'state' | 'scheduledDays'>; retired?: boolean };

/**
 * The headwords of the notes known (a card settled: a Review scheduled a week or more out, so a word seen
 * once, or lapsed since, doesn't count), skill cards left out: what a step's words are checked against.
 * With `deck`, only the notes in it and its subdecks.
 */
export function knownHeadwords(notes: Iterable<Note>, cards: Iterable<KnownCard>, deck?: string): string[] {
  const settled = new Set<string>();
  for (const c of cards) if (!c.retired && isSettled(c)) settled.add(c.noteId);
  const out: string[] = [];
  for (const n of notes) if (settled.has(n.id) && !n.tags.includes(SKILL_TAG) && (deck === undefined || isInDeck(n.deck, deck))) out.push(headword(n));
  return out;
}

/** `knownHeadwords` for any language deck, each worked out once. */
export function knownIn(notes: Iterable<Note>, cards: Iterable<KnownCard>): (deck: string) => string[] {
  const allNotes = [...notes];
  const allCards = [...cards];
  const memo = new Map<string, string[]>();
  return (deck) => {
    let found = memo.get(deck);
    if (!found) memo.set(deck, found = knownHeadwords(allNotes, allCards, deck));
    return found;
  };
}

/** What each skill card's step still waits for, by card id, given the known headwords of its language deck (`knownIn`). */
export function missingByCard(cards: Iterable<{ id: string; noteId: string }>, notes: Map<string, Note>, known: (languageDeck: string) => readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of cards) {
    const n = notes.get(c.noteId);
    const drill = n && drillOfTags(n.tags);
    if (!drill) continue;
    const words = known(skillLanguageDeck(n.deck));
    const missing = stepNeeds(drill.step.id, drill.language).flatMap((need) => stillNeeded(need, words) ?? []);
    if (missing.length) out.set(c.id, missing);
  }
  return out;
}
