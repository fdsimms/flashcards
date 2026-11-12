// A grammar point's page (docs/grammar.md, step 4): how Forms practice has gone on its forms, and
// whether to suggest marking it Know it. Pure, so the page only shows what these decide.
import { studyDayStart } from './day';
import { formGrammar, formsOf, headword, type PracticeRecord } from './forms';
import type { Note } from './types';

/** Study days of Forms practice a point's page counts. */
export const POINT_PRACTICE_DAYS = 30;
/** Answers, and the share of them right, before the page suggests Know it. */
export const KNOW_IT_ANSWERS = 20;
export const KNOW_IT_SHARE = 0.9;
/** Forms named under "Missed most". */
const MISSED_SHOWN = 3;

export interface PointPractice {
  answers: number;
  right: number;
  /** The forms missed most, most first: the right answer and its word ("tuvo (tener)"). */
  missed: string[];
}

/** When a point's page starts counting: the start of the study day `days - 1` days before today's. */
export function practiceSince(now: Date, dayStartsAtHour: number, days = POINT_PRACTICE_DAYS): Date {
  const start = studyDayStart(now, dayStartsAtHour);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

/** Forms practice on the point's forms (`formGrammar`) since `since`. */
export function pointPractice(pointId: string, notes: Note[], practice: PracticeRecord[], since: Date): PointPractice {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const formOf = new Map<string, { answer: string; word: string } | null>();
  const point = (r: PracticeRecord) => {
    const k = `${r.noteId}\u0000${r.key}`;
    if (!formOf.has(k)) {
      const note = byId.get(r.noteId);
      const form = note && formsOf(note).forms.find((f) => f.key === r.key);
      formOf.set(k, note && form && formGrammar(note, form)?.id === pointId ? { answer: form.answers[0], word: headword(note) } : null);
    }
    return formOf.get(k);
  };
  let answers = 0;
  let right = 0;
  const misses = new Map<string, number>();
  for (const r of practice) {
    if (new Date(r.practicedAt) < since) continue;
    const form = point(r);
    if (!form) continue;
    answers++;
    if (r.correct) right++;
    else {
      const label = `${form.answer} (${form.word})`;
      misses.set(label, (misses.get(label) ?? 0) + 1);
    }
  }
  const missed = [...misses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MISSED_SHOWN).map(([label]) => label);
  return { answers, right, missed };
}

/**
 * Whether the page suggests setting the point to Know it: enough answers, nearly all right, and
 * not already known. After "Not yet" (`dismissedAt`), only answers since then count, so it comes
 * back once there are enough new ones. Only a suggestion: nothing changes until the owner taps.
 */
export function suggestKnowIt(input: {
  state: 'practice' | 'avoid' | 'normal' | 'unset';
  pointId: string;
  notes: Note[];
  practice: PracticeRecord[];
  now: Date;
  dayStartsAtHour: number;
  dismissedAt?: string;
}): (PointPractice & { sinceNotYet: boolean }) | undefined {
  if (input.state === 'normal') return undefined;
  const window = practiceSince(input.now, input.dayStartsAtHour);
  const dismissed = input.dismissedAt ? new Date(input.dismissedAt) : undefined;
  const sinceNotYet = !!dismissed && dismissed > window;
  const results = pointPractice(input.pointId, input.notes, input.practice, sinceNotYet ? dismissed : window);
  const enough = results.answers >= KNOW_IT_ANSWERS && results.right >= KNOW_IT_SHARE * results.answers;
  return enough ? { ...results, sinceNotYet } : undefined;
}

/** "41 of 48 right in Forms practice over the last 30 days, and in 9 texts you read." */
export function knowItReason(results: PointPractice & { sinceNotYet: boolean }, textsRead: number): string {
  const when = results.sinceNotYet ? 'since you last chose Not yet' : `over the last ${POINT_PRACTICE_DAYS} days`;
  const texts = textsRead > 0 ? `, and in ${textsRead} ${textsRead === 1 ? 'text' : 'texts'} you read` : '';
  return `${results.right} of ${results.answers} right in Forms practice ${when}${texts}.`;
}
