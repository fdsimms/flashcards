import type { Language } from '../reader/api';
import type { NumberQuestion, NumberSaying } from './number';
import type { Phrase } from './phrase';
import { pickOther } from './random';
import { clockText, randomTime, type ClockTime, type MinuteStep, type TimeSaying } from './time';
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
