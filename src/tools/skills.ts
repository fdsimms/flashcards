import type { Language } from '../reader/api';
import { speechLangFor } from '../core/cards';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import type { NumberQuestion, NumberSaying } from './number';
import type { Phrase } from './phrase';
import { pickOther } from './random';
import { clockText, randomTime, type ClockTime, type MinuteStep, type TimeSaying } from './time';
import { CLASS_NAMES, CONSONANTS } from './thai/letters';
import { NUMBER_SAYERS, TIME_SAYERS } from './tools';

/**
 * Skill cards' drills: a skill with endless questions (any time, any number) as a ladder of steps,
 * each of which becomes one card in the collection. When the card comes up, its drill asks a few
 * questions drawn from the step (here), and the rating the learner taps for the card schedules the
 * skill. Nothing here rates, schedules or writes a card: `suggestedRating` only says which button to
 * outline (src/ui/tools/SkillDrill.tsx), and the learner's tap is what reaches FSRS.
 */

export type DrillGroup = 'time' | 'numbers';

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

export const DRILL_STEPS: DrillStep[] = [...TIME_STEPS, ...NUMBER_STEPS];

export const GROUP_TITLES: Record<DrillGroup, string> = { time: 'Telling the time', numbers: 'Numbers' };

export const drillStep = (id: string): DrillStep | undefined => DRILL_STEPS.find((s) => s.id === id);

/** Whether the language has the drills of a group (a saying for each question). */
export function hasDrills(group: DrillGroup, language: Language): boolean {
  return group === 'time' ? !!TIME_SAYERS[language] : !!NUMBER_SAYERS[language];
}

/** How many questions a drill asks before the card is rated. */
export const DRILL_QUESTIONS = 3;

export type DrillQuestion = { kind: 'time'; time: ClockTime } | { kind: 'number'; question: NumberQuestion };

/** A question's key, so the same one isn't asked twice in a row. */
export const questionKey = (q: DrillQuestion): string => (q.kind === 'time' ? clockText(q.time) : String(q.question.kind === 'phone' ? q.question.written : q.question.n));

/** A question for `step`, never `previous` again. */
export function drawQuestion(step: DrillStep, previous?: DrillQuestion, random: () => number = Math.random): DrillQuestion {
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

/** How a question reads on the card: its digits ("14:45", "2,400"). */
export function questionText(q: DrillQuestion): string {
  return q.kind === 'time' ? clockText(q.time) : q.question.kind === 'number' ? q.question.n.toLocaleString('en-US') : '';
}

/** A question's answer in `language`: the usual way to say it, the other ways heard, and a formal or written form where there is one. */
export function drillAnswer(q: DrillQuestion, language: Language): { everyday: Phrase; also: Phrase[]; last?: { title: string; phrase: Phrase } } | undefined {
  if (q.kind === 'time') {
    const s: TimeSaying | undefined = TIME_SAYERS[language]?.(q.time);
    return s && { everyday: s.everyday, also: s.also, last: { title: 'Formal', phrase: s.formal } };
  }
  const s: NumberSaying | undefined = NUMBER_SAYERS[language]?.(q.question);
  return s && { everyday: s.everyday, also: s.also };
}

/**
 * The rating to suggest once a drill is done, as a button's number (1 Again, 2 Hard, 3 Good): all
 * right is Good, one miss Hard, more Again. Only a suggestion: the learner taps the rating, and
 * Easy is theirs to choose.
 */
export function suggestedRating(results: readonly boolean[]): 1 | 2 | 3 {
  const missed = results.filter((r) => !r).length;
  return missed === 0 ? 3 : missed === 1 ? 2 : 1;
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

export type SkillGroup = DrillGroup | 'consonants';

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
  if (language === 'th') out.push({ id: 'consonants', title: 'Consonant classes', detail: `${CONSONANTS.length} cards, one per consonant`, count: CONSONANTS.length });
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
}

/** The suspended cards to release: those whose step before, in the same language, has settled. */
export function releasable(cards: readonly SkillCardState[]): string[] {
  const settled = new Set(cards.filter((c) => c.settled).map((c) => `${c.language}|${c.stepId}`));
  return cards.filter((c) => {
    if (!c.suspended) return false;
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
}

export interface SkillRow { title: string; detail: string; meter?: number; locked: boolean }
export interface SkillSection { title: string; rows: SkillRow[] }

const due = (days: number) => (days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Next in ${days} days`);

/** What Skills shows for a deck's skill cards: each drill step in ladder order, and a set of single cards as how many have settled. */
export function skillSections(cards: readonly SkillCardInfo[]): SkillSection[] {
  const sections: SkillSection[] = [];
  for (const group of ['time', 'numbers'] as DrillGroup[]) {
    const rows = DRILL_STEPS.filter((s) => s.group === group).flatMap((step): SkillRow[] => {
      const card = cards.find((c) => c.tags.includes(`${SKILL_TAG}::drill::${step.id}`));
      if (!card) return [];
      const before = step.after ? drillStep(step.after)?.title : undefined;
      if (card.suspended) return [{ title: step.title, detail: before ? `Comes in after ${before.charAt(0).toLowerCase() + before.slice(1)} settles` : 'Suspended', locked: true }];
      if (!card.started) return [{ title: step.title, detail: 'Not started yet', locked: false }];
      return [{ title: step.title, detail: due(card.dueInDays), meter: card.percent, locked: false }];
    });
    if (rows.length) sections.push({ title: GROUP_TITLES[group], rows });
  }
  const letters = cards.filter((c) => c.tags.includes(`${SKILL_TAG}::consonants`));
  if (letters.length) {
    const settled = letters.filter((c) => c.settled).length;
    const fresh = letters.filter((c) => !c.started).length;
    sections.push({
      title: 'Letters',
      rows: [{ title: 'Consonant classes', detail: `${settled} of ${letters.length} settled${fresh ? ` · ${fresh} not started` : ''}`, meter: Math.round((settled / letters.length) * 100), locked: false }],
    });
  }
  return sections;
}
