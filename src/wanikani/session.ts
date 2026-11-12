import { asksReading, type Assignment, type Subject } from './subjects';

/**
 * A WaniKani study session, as WaniKani runs one: each item is asked until it's answered right,
 * a wrong answer puts the question back a few cards later, and the item's review goes to WaniKani
 * once both its meaning and reading are right, with how many times each was missed.
 *
 * Lessons come after the reviews in batches (WaniKani's lesson batch size): each item of a batch
 * is shown (a `lesson` question), then the batch is quizzed like a review, and an item starts on
 * WaniKani once its quiz answers are right. Quiz misses don't count against it, as on WaniKani.
 *
 * How an item with a reading is asked (`QuestionMode`): `together`, one question covers meaning and
 * reading (flip mode; Again counts as one wrong meaning); `apart`, two questions anywhere in the
 * session, as WaniKani does; `adjacent`, two questions back to back (typing, with "separately" off).
 *
 * Undo: WaniKani can't take an answer back, so the latest finished item's answer is held here and
 * sent only when the next answer is given or the session closes (`Study`). Until then every answer
 * since the last one sent can be undone.
 */

export type QuestionKind = 'meaning' | 'reading' | 'both' | 'lesson';

export type QuestionMode = 'together' | 'apart' | 'adjacent';

export interface Question {
  assignmentId: number;
  kind: QuestionKind;
}

export interface SessionItem {
  assignmentId: number;
  subjectId: number;
  srsStage: number;
  asksReading: boolean;
  lesson: boolean;
}

interface Progress {
  meaning: boolean;
  reading: boolean;
  wrongMeaning: number;
  wrongReading: number;
  finished: boolean;
}

export interface Session {
  items: Record<number, SessionItem>;
  /** What's left to ask, the current question first. */
  queue: Question[];
  progress: Record<number, Progress>;
  /** Items finished, in order. */
  finished: number[];
}

/**
 * What WaniKani is told once an item is finished. `at` is when, for the request's timestamp;
 * `takenMs`, the time spent on it, is only for Stats (log.ts) and isn't sent.
 */
export type Outcome =
  | { kind: 'review'; assignmentId: number; subjectId: number; srsStage: number; wrongMeaning: number; wrongReading: number; at: string; takenMs?: number }
  | { kind: 'start'; assignmentId: number; subjectId: number; at: string; takenMs?: number };

/** A shuffled copy of `items` (Fisher-Yates), with the random source given so tests can pin it. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const TYPE_ORDER = ['radical', 'kanji', 'vocabulary', 'kana_vocabulary'];

/**
 * The items to study: every review whose subject was read (and isn't hidden), then up to
 * `lessonCount` lessons in WaniKani's default lesson order (by level, radicals before kanji before
 * words, then the subject's own lesson position).
 */
export function sessionItems(reviews: Assignment[], lessons: Assignment[], subjects: Map<number, Subject>, lessonCount: number): SessionItem[] {
  const usable = (a: Assignment) => {
    const s = subjects.get(a.subjectId);
    return !!s && !s.hidden;
  };
  const item = (a: Assignment, lesson: boolean): SessionItem => ({
    assignmentId: a.id, subjectId: a.subjectId, srsStage: a.srsStage, asksReading: asksReading(subjects.get(a.subjectId)!), lesson,
  });
  const ordered = lessons.filter(usable).sort((x, y) => {
    const a = subjects.get(x.subjectId)!;
    const b = subjects.get(y.subjectId)!;
    return a.level - b.level || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.lessonPosition - b.lessonPosition;
  });
  return [...reviews.filter(usable).map((a) => item(a, false)), ...ordered.slice(0, Math.max(0, lessonCount)).map((a) => item(a, true))];
}

/** Which question mode the options mean: typing can't take both answers in one box. */
export function questionMode(answer: 'type' | 'flip', separate: boolean): QuestionMode {
  return separate ? 'apart' : answer === 'flip' ? 'together' : 'adjacent';
}

/**
 * A session over `items`: reviews first, shuffled (WaniKani's default order), then lessons in the
 * order given. Asked apart, an item's meaning and reading are shuffled in with everything else.
 */
/** Lessons shown before each quiz when WaniKani's own batch size isn't known. */
export const LESSON_BATCH = 5;

export function buildSession(items: SessionItem[], opts: { mode: QuestionMode; lessonBatch?: number }, random: () => number = Math.random): Session {
  const reviews = items.filter((i) => !i.lesson);
  const lessons = items.filter((i) => i.lesson);
  const questionsOf = (i: SessionItem): Question[] => {
    if (!i.asksReading) return [{ assignmentId: i.assignmentId, kind: 'meaning' }];
    if (opts.mode === 'together') return [{ assignmentId: i.assignmentId, kind: 'both' }];
    return [{ assignmentId: i.assignmentId, kind: 'meaning' }, { assignmentId: i.assignmentId, kind: 'reading' }];
  };
  const quiz = (group: SessionItem[]) => (opts.mode === 'apart'
    ? shuffled(group.flatMap(questionsOf), random)
    : shuffled(group, random).flatMap(questionsOf));
  const batch = Math.max(1, opts.lessonBatch ?? LESSON_BATCH);
  const lessonQuestions: Question[] = [];
  for (let i = 0; i < lessons.length; i += batch) {
    const group = lessons.slice(i, i + batch);
    lessonQuestions.push(...group.map((l): Question => ({ assignmentId: l.assignmentId, kind: 'lesson' })), ...quiz(group));
  }
  return {
    items: Object.fromEntries(items.map((i) => [i.assignmentId, i])),
    queue: [...quiz(reviews), ...lessonQuestions],
    progress: Object.fromEntries(items.map((i) => [i.assignmentId, { meaning: false, reading: !i.asksReading, wrongMeaning: 0, wrongReading: 0, finished: false }])),
    finished: [],
  };
}

export function currentQuestion(s: Session): Question | undefined {
  return s.queue[0];
}

/**
 * How far back a missed question goes: a few cards later, as WaniKani does, but never past the
 * next lesson shown, so a missed review is asked again before the lessons, and a lesson quiz's
 * question within its own batch.
 */
function requeueAt(rest: Question[], random: () => number): number {
  const nextLesson = rest.findIndex((q) => q.kind === 'lesson');
  return Math.min(nextLesson === -1 ? rest.length : nextLesson, 3 + Math.floor(random() * 8));
}

/**
 * The session after the current question is answered (`correct`), and the outcome to send when it
 * finished an item. A lesson is always "correct": seeing it is the lesson.
 */
export function answerQuestion(s: Session, correct: boolean, at: Date, random: () => number = Math.random): { session: Session; outcome?: Outcome } {
  const q = s.queue[0];
  if (!q) return { session: s };
  const item = s.items[q.assignmentId];
  const before = s.progress[q.assignmentId];
  const rest = s.queue.slice(1);
  // Seeing a lesson is the lesson; its quiz comes after the batch.
  if (q.kind === 'lesson') return { session: { ...s, queue: rest } };
  if (!correct) {
    const p = q.kind === 'reading' ? { ...before, wrongReading: before.wrongReading + 1 } : { ...before, wrongMeaning: before.wrongMeaning + 1 };
    const queue = [...rest];
    queue.splice(requeueAt(rest, random), 0, q);
    return { session: { ...s, queue, progress: { ...s.progress, [q.assignmentId]: p } } };
  }
  const p: Progress = {
    ...before,
    meaning: before.meaning || q.kind !== 'reading',
    reading: before.reading || q.kind !== 'meaning',
  };
  if (!(p.meaning && p.reading)) return { session: { ...s, queue: rest, progress: { ...s.progress, [q.assignmentId]: p } } };
  const session = { ...s, queue: rest, progress: { ...s.progress, [q.assignmentId]: { ...p, finished: true } }, finished: [...s.finished, q.assignmentId] };
  if (item.lesson) return { session, outcome: { kind: 'start', assignmentId: item.assignmentId, subjectId: item.subjectId, at: at.toISOString() } };
  return {
    session,
    outcome: {
      kind: 'review', assignmentId: item.assignmentId, subjectId: item.subjectId, srsStage: item.srsStage,
      wrongMeaning: p.wrongMeaning, wrongReading: p.wrongReading, at: at.toISOString(),
    },
  };
}

/** Wrong answers so far for an item, meaning and reading together: what decides how far it drops. */
export function wrongSoFar(s: Session, assignmentId: number): number {
  const p = s.progress[assignmentId];
  return p ? p.wrongMeaning + p.wrongReading : 0;
}

/** Reviews and lessons not finished yet: the session's own due and new counts. */
export function remaining(s: Session): { reviews: number; lessons: number } {
  let reviews = 0;
  let lessons = 0;
  for (const id of Object.keys(s.items)) {
    const item = s.items[Number(id)];
    if (s.progress[item.assignmentId].finished) continue;
    if (item.lesson) lessons++;
    else reviews++;
  }
  return { reviews, lessons };
}

/** How far through: items finished over all items. */
export function sessionProgress(s: Session): number {
  const total = Object.keys(s.items).length;
  return total ? s.finished.length / total : 0;
}

/** A session with what's held back for undo (see the top of this file). */
export interface Study {
  session: Session;
  /** The latest finished item's outcome, not sent yet. */
  held: Outcome | null;
  /** Sessions to go back to, newest last; none past the last outcome sent. */
  history: Session[];
}

export function startStudy(session: Session): Study {
  return { session, held: null, history: [] };
}

/** Answers the current question. `send` is what must now go to WaniKani: the outcome that was held. */
export function studyAnswer(study: Study, correct: boolean, at: Date, random: () => number = Math.random): { study: Study; send: Outcome[] } {
  if (!study.session.queue.length) return { study, send: [] };
  const send = study.held ? [study.held] : [];
  // Once the held outcome is sent, nothing before this answer can be undone.
  const history = study.held ? [study.session] : [...study.history, study.session];
  const { session, outcome } = answerQuestion(study.session, correct, at, random);
  return { study: { session, held: outcome ?? null, history }, send };
}

export function canUndo(study: Study): boolean {
  return study.history.length > 0;
}

/** Takes back the latest answer, and drops the held outcome it made. Null when there's nothing to undo. */
export function studyUndo(study: Study): Study | null {
  if (!study.history.length) return null;
  return { session: study.history[study.history.length - 1], held: null, history: study.history.slice(0, -1) };
}

/** Closing the session: whatever is held goes now. */
export function studyFlush(study: Study): { study: Study; send: Outcome[] } {
  return { study: { ...study, held: null, history: [] }, send: study.held ? [study.held] : [] };
}
