import type { DrillQuestion } from './skills';

/**
 * A skill card's questions for one study day, kept so they don't change under the learner: the same
 * card shown again (after an undo, or later that day) asks the same ones, and tomorrow's are new.
 * `round` is the day's full set, drawn the first time the card comes up. `carry` is what was missed
 * when the card was last answered Again or Hard that day: a return asks only those, not a fresh
 * round, since a skill card is a little practice woven into the reviews, not a session of its own.
 * Per card, one record: a record from an earlier day, or for another step, counts as none.
 * Practice only; nothing here reaches a rating (tests/tools/noGrading.test.ts).
 */
export interface CardRound {
  /** The study day (`studyDayKey`), the step the questions are from, and the questions. */
  day: string;
  stepId: string;
  round: DrillQuestion[];
  carry: DrillQuestion[];
}

/** Every card's record, by card id. */
export type CardRounds = Record<string, CardRound>;

/** The record for `cardId` if it's from `day` and `stepId`; otherwise none. */
export function roundOf(rounds: CardRounds, cardId: string, day: string, stepId: string): CardRound | undefined {
  const found = rounds[cardId];
  return found && found.day === day && found.stepId === stepId ? found : undefined;
}

/** What the card asks: what it carried from a miss that day, else the day's round. */
export const questionsToAsk = (record: CardRound): DrillQuestion[] => (record.carry.length ? record.carry : record.round);

/** `rounds` with a new round for the card (its carry starts empty), and every record from an earlier day dropped. */
export function withRound(rounds: CardRounds, cardId: string, day: string, stepId: string, round: DrillQuestion[]): CardRounds {
  const today = Object.fromEntries(Object.entries(rounds).filter(([, r]) => r.day === day));
  return { ...today, [cardId]: { day, stepId, round, carry: [] } };
}

/** `rounds` with the card's carry set (empty clears it). Unchanged when the card has no record. */
export function withCarry(rounds: CardRounds, cardId: string, carry: DrillQuestion[]): CardRounds {
  const record = rounds[cardId];
  return record ? { ...rounds, [cardId]: { ...record, carry } } : rounds;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Whether `v` is a question this version can show: a stored one from an older shape is dropped, not drawn wrongly. */
export function isDrillQuestion(v: unknown): v is DrillQuestion {
  if (!isObject(v)) return false;
  switch (v.kind) {
    case 'time': return isObject(v.time) && isNumber(v.time.hour) && isNumber(v.time.minute);
    case 'number': return isObject(v.question) && (isNumber(v.question.n) || typeof v.question.written === 'string');
    case 'date': return isObject(v.date) && isNumber(v.date.year) && isNumber(v.date.month) && isNumber(v.date.day) && isObject(v.parts);
    case 'money': return isNumber(v.amount);
    case 'count': return isObject(v.question) && isNumber(v.question.noun) && isNumber(v.question.n);
    default: return false;
  }
}

/** What was saved, read back leniently: a record that isn't whole is dropped. */
export function parseRounds(raw: unknown): CardRounds {
  if (!isObject(raw)) return {};
  const out: CardRounds = {};
  for (const [cardId, r] of Object.entries(raw)) {
    if (!isObject(r) || typeof r.day !== 'string' || typeof r.stepId !== 'string' || !Array.isArray(r.round) || !Array.isArray(r.carry)) continue;
    if (!r.round.length || !r.round.every(isDrillQuestion)) continue;
    out[cardId] = { day: r.day, stepId: r.stepId, round: r.round, carry: r.carry.filter(isDrillQuestion) };
  }
  return out;
}

/** What was read from the file with the rounds made since: those win, as they are what the learner was shown. */
export const mergeRounds = (stored: CardRounds, fresh: CardRounds): CardRounds => ({ ...stored, ...fresh });
