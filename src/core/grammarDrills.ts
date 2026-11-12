// Grammar drills (docs/grammar.md, step 5): when each grammar point is next drilled. Spaced by
// point, not by question, and worked out from the drills' answers every time, never stored, so a
// drill undone or restored from a backup reschedules itself. Nothing here touches a card.
import { studyDayStart } from './day';
import { grammarPoint } from './grammar';

/** One answer in a drill, as the phone keeps it (`grammar_answers`). */
export interface GrammarAnswer {
  pointId: string;
  /** The drill it was given in: answers given together count together. */
  drillId: string;
  kind: 'which' | 'gap';
  correct: boolean;
  /** ISO. */
  answeredAt: string;
}

/** The choices a point can have, as Read & Listen's server keeps them. */
export type DrillState = 'practice' | 'avoid' | 'normal' | 'unset';

/** Days to the next drill after each drill in a row that went well: Practice, then Know it at longer gaps, to keep it known. */
export const PRACTICE_STEPS = [1, 3, 7, 14, 30] as const;
export const KNOWN_STEPS = [7, 14, 30, 60] as const;
/** The share right that counts a point's part of a drill as gone well. */
export const DRILL_PASS = 0.8;
/** Questions in a drill, and the most points one drill mixes. */
export const DRILL_QUESTIONS = 10;
export const DRILL_POINTS = 3;

const stepsFor = (state: DrillState) => (state === 'normal' ? KNOWN_STEPS : PRACTICE_STEPS);

export interface PointSchedule {
  pointId: string;
  state: DrillState;
  /** The start of the study day it's next due; a point never drilled is due today. */
  due: Date;
  /** Drills in a row that went well, capped at the last step. -1 for never drilled. */
  step: number;
  lastDrilled?: Date;
}

/** Whether a point is drilled at all: Practice and Know it are; Not set and Don't know it aren't. */
export function isDrilled(state: DrillState | undefined): state is 'practice' | 'normal' {
  return state === 'practice' || state === 'normal';
}

/** When a point is next due, from its drills' answers (any order; grouped by drill). */
export function pointSchedule(pointId: string, state: DrillState, answers: GrammarAnswer[], now: Date, dayStartsAtHour: number): PointSchedule {
  const steps = stepsFor(state);
  const drills = new Map<string, { at: string; right: number; total: number }>();
  for (const a of answers) {
    if (a.pointId !== pointId) continue;
    const d = drills.get(a.drillId) ?? { at: a.answeredAt, right: 0, total: 0 };
    if (a.answeredAt < d.at) d.at = a.answeredAt;
    d.total++;
    if (a.correct) d.right++;
    drills.set(a.drillId, d);
  }
  let step = -1;
  let last: Date | undefined;
  for (const d of [...drills.values()].sort((a, b) => a.at.localeCompare(b.at))) {
    step = d.right >= DRILL_PASS * d.total ? Math.min(step + 1, steps.length - 1) : 0;
    last = new Date(d.at);
  }
  if (!last) return { pointId, state, due: studyDayStart(now, dayStartsAtHour), step };
  const due = studyDayStart(last, dayStartsAtHour);
  // A drill that didn't go well brings the point back the next day, as the first step does.
  due.setDate(due.getDate() + steps[Math.max(step, 0)]);
  return { pointId, state, due, step, lastDrilled: last };
}

/**
 * The points due today in a language (Practice and Know it only), Practice first, then the longest
 * overdue. `choices` is Read & Listen's, by point id; a point not in the catalog is left out.
 */
export function duePoints(
  language: string,
  choices: Record<string, DrillState>,
  answers: GrammarAnswer[],
  now: Date,
  dayStartsAtHour: number,
): PointSchedule[] {
  const today = studyDayStart(now, dayStartsAtHour);
  return scheduledPoints(language, choices, answers, now, dayStartsAtHour)
    .filter((s) => s.due <= today)
    .sort((a, b) => Number(b.state === 'practice') - Number(a.state === 'practice') || a.due.getTime() - b.due.getTime());
}

/** Whether any of the languages has a point drilled, which is when the Grammar tool has something to show. */
export function anyDrilled(languages: readonly string[], choices: Record<string, DrillState>): boolean {
  return Object.entries(choices).some(([id, state]) => isDrilled(state) && languages.includes(grammarPoint(id)?.language ?? ''));
}

/** Every point drilled in a language, with when it's next due, soonest first. */
export function scheduledPoints(
  language: string,
  choices: Record<string, DrillState>,
  answers: GrammarAnswer[],
  now: Date,
  dayStartsAtHour: number,
): PointSchedule[] {
  return Object.entries(choices)
    .filter(([id, state]) => isDrilled(state) && grammarPoint(id)?.language === language)
    .map(([id, state]) => pointSchedule(id, state, answers, now, dayStartsAtHour))
    .sort((a, b) => a.due.getTime() - b.due.getTime() || a.pointId.localeCompare(b.pointId));
}

/** "Due today", "Tomorrow", "In 6 days", by study days. */
export function dueWhen(due: Date, now: Date, dayStartsAtHour: number): string {
  const days = Math.round((due.getTime() - studyDayStart(now, dayStartsAtHour).getTime()) / 86400000);
  return days <= 0 ? 'Due today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
}

/** A point's drill answers since `since`, right and in all, for the Know it suggestion. */
export function drillResults(pointId: string, answers: GrammarAnswer[], since: Date): { answers: number; right: number } {
  const mine = answers.filter((a) => a.pointId === pointId && new Date(a.answeredAt) >= since);
  return { answers: mine.length, right: mine.filter((a) => a.correct).length };
}

// ---------------------------------------------------------------------------------------------
// A drill's questions, as the screen asks them

/** A question as Read & Listen's server sends it (`POST /api/drills`; src/reader/api.ts calls it DrillQuestion). */
export type DrillQuestionIn =
  | { kind: 'which'; point: string; line: string; words: string[]; english: string; title: string; choices: string[] }
  | { kind: 'gap'; id: number; point: string; before: string; answer: string; after: string; english: string; wrong: string[]; hint: string };

export interface DrillPrompt {
  pointId: string;
  kind: 'which' | 'gap';
  /** The sentence around what's asked: for "which", the line split at the point's words. */
  before: string;
  /** The words asked about ("which") or the gap's answer ("gap"), shown once answered. */
  middle: string;
  after: string;
  english: string;
  /** Shown above the sentence: for a gap, the point and the hint ("Preterite · ir, nosotros"); Thai's points name the answer, so only the hint. */
  label: string;
  /** "From Al mercado", for a line read. */
  source?: string;
  /** What to pick from, shuffled; the answer is one of them. */
  choices: string[];
  answer: string;
  /** Whether a gap can be typed (a "which" is always picked). */
  typable: boolean;
}

function shuffled<T>(xs: T[], random: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The questions as the screen asks them, in the server's order. One for a point the app's catalog doesn't have is left out. */
export function drillPrompts(questions: DrillQuestionIn[], random: () => number = Math.random): DrillPrompt[] {
  const out: DrillPrompt[] = [];
  for (const q of questions) {
    const point = grammarPoint(q.point);
    if (!point) continue;
    if (q.kind === 'which') {
      const names = q.choices.map((id) => grammarPoint(id)?.name).filter((n): n is string => !!n);
      const word = q.words[0] ?? '';
      const at = word ? q.line.toLocaleLowerCase().indexOf(word.toLocaleLowerCase()) : -1;
      if (at < 0 || names.length < 2) continue;
      out.push({
        pointId: point.id, kind: 'which',
        before: q.line.slice(0, at), middle: q.line.slice(at, at + word.length), after: q.line.slice(at + word.length),
        english: q.english, label: 'Which is the underlined part?', source: `From ${q.title}`,
        choices: shuffled(names, random), answer: point.name, typable: false,
      });
    } else {
      const names = point.language === 'th' ? [] : [point.name];
      out.push({
        pointId: point.id, kind: 'gap', before: q.before, middle: q.answer, after: q.after, english: q.english,
        label: [...names, q.hint].filter(Boolean).join(' · '),
        choices: shuffled([q.answer, ...q.wrong], random), answer: q.answer, typable: true,
      });
    }
  }
  return out;
}

/** What to say about points that got no question, if any. */
export function missingNote(missing: string[], writing: boolean): string | undefined {
  const names = missing.map((id) => grammarPoint(id)?.name).filter((n): n is string => !!n);
  if (!names.length) return undefined;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return writing
    ? `No questions for ${list} yet. They're being written now, so try again in a minute.`
    : `No questions for ${list} yet. Read a text that uses it, or add a Claude key to Read & Listen's server to have questions written.`;
}
