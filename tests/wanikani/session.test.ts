import { describe, expect, it } from 'vitest';
import {
  answerQuestion, askLater, buildSession, canAskLater, canMarkCorrect, canUndo, currentQuestion, questionMode, remaining, REVIEW_WINDOW, sessionProgress,
  shuffled, startStudy, studyAnswer, studyAskLater, studyFlush, studyUndo, type SessionItem,
  sessionItems, windows, wrongSoFar,
} from '../../src/wanikani/session';
import { parseAssignment, parseSubject } from '../../src/wanikani/subjects';
import { assignmentResource, kanaVocabResource, kanjiResource, radicalResource, vocabResource } from './fixtures';

const at = new Date(2026, 10, 12, 12);
// Always the first slot: no shuffling, and a missed question goes back three places (or last).
const first = () => 0;

const vocab: SessionItem = { assignmentId: 1, subjectId: 101, srsStage: 4, asksReading: true, lesson: false };
const radical: SessionItem = { assignmentId: 2, subjectId: 102, srsStage: 6, asksReading: false, lesson: false };
const lesson: SessionItem = { assignmentId: 3, subjectId: 103, srsStage: 0, asksReading: true, lesson: true };

describe('building a session', () => {
  it('asks meaning and reading together, or apart, and only meaning for an item with no reading', () => {
    expect(buildSession([vocab, radical], { mode: 'together' }, first).queue).toEqual(expect.arrayContaining([
      { assignmentId: 1, kind: 'both' }, { assignmentId: 2, kind: 'meaning' },
    ]));
    const apart = buildSession([vocab, radical], { mode: 'apart' }, first).queue;
    expect(apart).toHaveLength(3);
    expect(apart).toEqual(expect.arrayContaining([
      { assignmentId: 1, kind: 'meaning' }, { assignmentId: 1, kind: 'reading' }, { assignmentId: 2, kind: 'meaning' },
    ]));
  });

  it('asks an item\'s meaning and reading back to back when typed with "separately" off', () => {
    expect(buildSession([vocab, radical], { mode: 'adjacent' }, first).queue).toEqual([
      { assignmentId: 2, kind: 'meaning' }, { assignmentId: 1, kind: 'meaning' }, { assignmentId: 1, kind: 'reading' },
    ]);
  });

  it('reads the options as a question mode', () => {
    expect(questionMode('flip', false)).toBe('together');
    expect(questionMode('type', false)).toBe('adjacent');
    expect(questionMode('type', true)).toBe('apart');
    expect(questionMode('flip', true)).toBe('apart');
  });

  it('puts lessons after the reviews, each batch shown and then quizzed', () => {
    const s = buildSession([lesson, vocab], { mode: 'together' }, first);
    expect(s.queue.map((q) => q.kind)).toEqual(['both', 'lesson', 'both']);
    expect(remaining(s)).toEqual({ reviews: 1, lessons: 1 });
    const lessons = [3, 4, 5].map((n): SessionItem => ({ ...lesson, assignmentId: n, subjectId: n }));
    const batched = buildSession(lessons, { mode: 'apart', lessonBatch: 2 }, first).queue;
    expect(batched.map((q) => (q.kind === 'lesson' ? `show ${q.assignmentId}` : q.assignmentId))).toEqual([
      'show 3', 'show 4', 3, 4, 4, 3, 'show 5', 5, 5,
    ]);
  });

  it('asks reviews apart in windows of about ten items, so an item is never left half done for long', () => {
    let seed = 11;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const items = Array.from({ length: 100 }, (_, n): SessionItem => ({ ...vocab, assignmentId: n + 1, subjectId: n + 1 }));
    const queue = buildSession(items, { mode: 'apart' }, random).queue;
    expect(queue).toHaveLength(200);
    const pos = new Map<string, number>();
    queue.forEach((q, i) => pos.set(`${q.assignmentId}:${q.kind}`, i));
    expect(pos.size).toBe(200);
    // Each window of ten items is asked whole before the next: 20 questions each.
    for (let w = 0; w < 10; w++) {
      expect(new Set(queue.slice(w * 20, w * 20 + 20).map((q) => q.assignmentId)).size).toBe(10);
    }
    const gaps = items.map((i) => Math.abs(pos.get(`${i.assignmentId}:meaning`)! - pos.get(`${i.assignmentId}:reading`)!));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2 * REVIEW_WINDOW - 1);
    // Still shuffled: the reviews don't come out in the order given.
    expect(queue.map((q) => q.assignmentId)).not.toEqual([...queue.map((q) => q.assignmentId)].sort((a, b) => a - b));
  });

  it('keeps every window about the same size, so the last is not a stub', () => {
    expect(windows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 10).map((w) => w.length)).toEqual([6, 5]);
    expect(windows(Array.from({ length: 23 }, (_, i) => i), 10).map((w) => w.length)).toEqual([8, 8, 7]);
    expect(windows([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    expect(windows([], 10)).toEqual([]);
    expect(windows(Array.from({ length: 23 }, (_, i) => i), 10).flat()).toEqual(Array.from({ length: 23 }, (_, i) => i));
  });

  it('shuffles every item into the result exactly once', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out = shuffled([1, 2, 3, 4, 5, 6], random);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('choosing what to study', () => {
  it("takes every review, then today's lessons in WaniKani's lesson order", () => {
    const subjects = new Map([vocabResource, kanjiResource, radicalResource, kanaVocabResource].map((r) => {
      const s = parseSubject(r)!;
      return [s.id, s];
    }));
    const assign = (id: number, subjectId: number, data = {}) => parseAssignment(assignmentResource(id, subjectId, data))!;
    const reviews = [assign(1, 2467), assign(2, 99999)];
    const lessons = [assign(10, 2467, { srs_stage: 0 }), assign(11, 450, { srs_stage: 0 }), assign(12, 9001, { srs_stage: 0 }), assign(13, 8762, { srs_stage: 0 })];
    const items = sessionItems(reviews, lessons, subjects, 3);
    // The review whose subject wasn't read is left out.
    expect(items.filter((i) => !i.lesson).map((i) => i.assignmentId)).toEqual([1]);
    // Level 1 kana word, level 2 kanji, level 3 word (the level 5 radical waits).
    expect(items.filter((i) => i.lesson).map((i) => i.assignmentId)).toEqual([12, 11, 10]);
    expect(items.find((i) => i.assignmentId === 12)?.asksReading).toBe(false);
    expect(sessionItems(reviews, lessons, subjects, 0).filter((i) => i.lesson)).toEqual([]);
  });
});

describe('answering', () => {
  it('sends a review once both meaning and reading are right, with the misses of each', () => {
    let s = buildSession([vocab], { mode: 'apart' }, first);
    // Shuffled with `first`: reading then meaning.
    const order = s.queue.map((q) => q.kind);
    ({ session: s } = answerQuestion(s, false, at, first)); // misses the first question
    expect(s.queue).toHaveLength(2);
    expect(s.queue[1].kind).toBe(order[0]); // back in the queue, after the other one
    let r = answerQuestion(s, true, at, first);
    expect(r.outcome).toBeUndefined();
    r = answerQuestion(r.session, true, at, first);
    expect(r.outcome).toEqual({
      kind: 'review', assignmentId: 1, subjectId: 101, srsStage: 4,
      wrongMeaning: order[0] === 'meaning' ? 1 : 0, wrongReading: order[0] === 'reading' ? 1 : 0, at: at.toISOString(),
    });
    expect(currentQuestion(r.session)).toBeUndefined();
    expect(sessionProgress(r.session)).toBe(1);
  });

  it('counts Again on a question asked together as one wrong meaning', () => {
    let s = buildSession([vocab], { mode: 'together' }, first);
    ({ session: s } = answerQuestion(s, false, at, first));
    expect(currentQuestion(s)).toEqual({ assignmentId: 1, kind: 'both' });
    const r = answerQuestion(s, true, at, first);
    expect(r.outcome).toMatchObject({ kind: 'review', wrongMeaning: 1, wrongReading: 0 });
  });

  it('starts a lesson once its quiz is answered right, whatever was missed on the way', () => {
    let r = answerQuestion(buildSession([lesson], { mode: 'together' }, first), true, at, first);
    expect(r.outcome).toBeUndefined();
    expect(currentQuestion(r.session)).toEqual({ assignmentId: 3, kind: 'both' });
    r = answerQuestion(r.session, false, at, first);
    expect(r.outcome).toBeUndefined();
    expect(remaining(r.session)).toEqual({ reviews: 0, lessons: 1 });
    r = answerQuestion(r.session, true, at, first);
    expect(r.outcome).toEqual({ kind: 'start', assignmentId: 3, subjectId: 103, at: at.toISOString() });
    expect(remaining(r.session)).toEqual({ reviews: 0, lessons: 0 });
  });

  it('asks a missed review again before the lessons, and a missed quiz question within its batch', () => {
    const items = [1, 2].map((n): SessionItem => ({ assignmentId: n, subjectId: n, srsStage: 1, asksReading: false, lesson: false }));
    const lessons = [3, 4].map((n): SessionItem => ({ ...lesson, assignmentId: n, subjectId: n, asksReading: false }));
    let s = buildSession([...items, ...lessons], { mode: 'apart', lessonBatch: 1 }, first);
    const missed = s.queue[0];
    ({ session: s } = answerQuestion(s, false, at, first));
    expect(s.queue.indexOf(missed)).toBe(1);
    expect(s.queue[2].kind).toBe('lesson');
    // Through to the first lesson's quiz question, then miss it.
    ({ session: s } = answerQuestion(s, true, at, first));
    ({ session: s } = answerQuestion(s, true, at, first));
    ({ session: s } = answerQuestion(s, true, at, first));
    expect(currentQuestion(s)).toEqual({ assignmentId: 3, kind: 'meaning' });
    ({ session: s } = answerQuestion(s, false, at, first));
    expect(s.queue.map((q) => [q.assignmentId, q.kind])).toEqual([[3, 'meaning'], [4, 'lesson'], [4, 'meaning']]);
  });

  it('puts a missed question a few places back', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n): SessionItem => ({ assignmentId: n, subjectId: n, srsStage: 1, asksReading: false, lesson: false }));
    const s = buildSession(items, { mode: 'together' }, first);
    const missed = s.queue[0];
    const { session } = answerQuestion(s, false, at, first);
    expect(session.queue.indexOf(missed)).toBe(3);
  });
});

describe('undo', () => {
  it('holds the finished item until the next answer, so it can be taken back', () => {
    let study = startStudy(buildSession([vocab, radical], { mode: 'together' }, first));
    let r = studyAnswer(study, true, at, first);
    expect(r.send).toEqual([]);
    expect(r.study.held).not.toBeNull();
    expect(canUndo(r.study)).toBe(true);
    const undone = studyUndo(r.study)!;
    expect(undone.held).toBeNull();
    expect(undone.session).toEqual(study.session);
    expect(canUndo(undone)).toBe(false);

    // Answered again, then the next answer sends it.
    r = studyAnswer(undone, true, at, first);
    const finished = r.study.held;
    r = studyAnswer(r.study, false, at, first);
    expect(r.send).toEqual([finished]);
    // Only the answer after the one sent can be undone.
    study = studyUndo(r.study)!;
    expect(study.session.finished).toHaveLength(1);
    expect(canUndo(study)).toBe(false);
  });

  it('can go back over several misses while nothing is sent', () => {
    const items = [vocab, radical];
    let study = startStudy(buildSession(items, { mode: 'together' }, first));
    study = studyAnswer(study, false, at, first).study;
    study = studyAnswer(study, false, at, first).study;
    expect(study.history).toHaveLength(2);
    study = studyUndo(studyUndo(study)!)!;
    expect(study.session).toEqual(buildSession(items, { mode: 'together' }, first));
    expect(wrongSoFar(study.session, vocab.assignmentId) + wrongSoFar(study.session, radical.assignmentId)).toBe(0);
  });

  // Typed: vocab's meaning, then its reading, then the radical, in that order.
  const typedStudy = () => startStudy({
    ...buildSession([vocab, radical], { mode: 'apart' }, first),
    queue: [{ assignmentId: 1, kind: 'meaning' }, { assignmentId: 1, kind: 'reading' }, { assignmentId: 2, kind: 'meaning' }],
  }, true);

  it('keeps a typed miss when its answer is undone, since the right answer was shown', () => {
    const start = typedStudy();
    let study = studyAnswer(start, false, at, first).study;
    study = studyUndo(study)!;
    // Back to the same question, in the same place, with the miss still counted.
    expect(study.session.queue).toEqual(start.session.queue);
    expect(study.session.progress[1]).toMatchObject({ wrongMeaning: 1, wrongReading: 0, meaning: false });
    // Answered right now, the item still goes to WaniKani with the miss.
    study = studyAnswer(study, true, at, first).study;
    study = studyAnswer(study, true, at, first).study;
    expect(study.held).toMatchObject({ assignmentId: 1, wrongMeaning: 1, wrongReading: 0 });
  });

  it('keeps every typed miss when undoing back over several answers', () => {
    let study = typedStudy();
    study = studyAnswer(study, false, at, first).study; // vocab's meaning
    study = studyAnswer(study, false, at, first).study; // vocab's reading
    study = studyUndo(studyUndo(study)!)!;
    expect(study.session.progress[1]).toMatchObject({ wrongMeaning: 1, wrongReading: 1 });
    expect(study.session.queue).toEqual(typedStudy().session.queue);
  });

  it('counts a typed miss that was shown but not yet counted when undo goes back past it', () => {
    let study = studyAnswer(typedStudy(), true, at, first).study; // vocab's meaning, right
    // The reading is typed wrong and its answer shown; undo is tapped before Next.
    study = studyUndo(study, true)!;
    expect(currentQuestion(study.session)).toEqual({ assignmentId: 1, kind: 'meaning' });
    expect(study.session.progress[1]).toMatchObject({ meaning: false, wrongMeaning: 0, wrongReading: 1 });
  });

  it('takes back a rated Again, which may have been a mistaken tap', () => {
    let study = startStudy(buildSession([vocab], { mode: 'together' }, first));
    study = studyUndo(studyAnswer(study, false, at, first).study)!;
    expect(wrongSoFar(study.session, vocab.assignmentId)).toBe(0);
  });
});

describe('marking a typed answer correct', () => {
  it('is offered for a meaning only, never a reading', () => {
    expect(canMarkCorrect({ assignmentId: 1, kind: 'meaning' })).toBe(true);
    expect(canMarkCorrect({ assignmentId: 1, kind: 'reading' })).toBe(false);
    expect(canMarkCorrect({ assignmentId: 1, kind: 'both' })).toBe(false);
    expect(canMarkCorrect({ assignmentId: 1, kind: 'lesson' })).toBe(false);
    expect(canMarkCorrect(undefined)).toBe(false);
  });

  it('sends what is held when the session closes', () => {
    const r = studyAnswer(startStudy(buildSession([radical], { mode: 'together' }, first)), true, at, first);
    const closed = studyFlush(r.study);
    expect(closed.send).toEqual([r.study.held]);
    expect(closed.study.held).toBeNull();
    expect(canUndo(closed.study)).toBe(false);
  });
});

describe('asking later', () => {
  const three = (n: number): SessionItem => ({ ...radical, assignmentId: n, subjectId: n });
  const ids = (s: { queue: { assignmentId: number }[] }) => s.queue.map((q) => q.assignmentId);
  // A session with its questions in the order given, since building one shuffles.
  const inOrder = (items: SessionItem[], order: [number, 'meaning' | 'lesson'][]) => ({
    ...buildSession(items, { mode: 'together' }, first),
    queue: order.map(([assignmentId, kind]) => ({ assignmentId, kind })),
  });

  it('moves the question to the back of the reviews, counting nothing wrong', () => {
    const s = inOrder([three(1), three(2), three(3)], [[1, 'meaning'], [2, 'meaning'], [3, 'meaning']]);
    const later = askLater(s);
    expect(ids(later)).toEqual([2, 3, 1]);
    expect(later.progress).toEqual(s.progress);
  });

  it('keeps a review in front of the lessons, and a quiz question within its batch', () => {
    const lessons = [10, 11, 12].map((n): SessionItem => ({ ...lesson, assignmentId: n, subjectId: n, asksReading: false }));
    const items = [three(1), three(2), ...lessons];
    const reviews = inOrder(items, [[1, 'meaning'], [2, 'meaning'], [10, 'lesson'], [11, 'lesson'], [10, 'meaning'], [11, 'meaning'], [12, 'lesson'], [12, 'meaning']]);
    expect(ids(askLater(reviews))).toEqual([2, 1, 10, 11, 10, 11, 12, 12]);
    const quiz = inOrder(items, [[10, 'meaning'], [11, 'meaning'], [12, 'lesson'], [12, 'meaning']]);
    expect(askLater(quiz).queue.map((q) => `${q.kind}${q.assignmentId}`)).toEqual(['meaning11', 'meaning10', 'lesson12', 'meaning12']);
  });

  it('does nothing for a lesson being shown, or when nothing else is in the pile', () => {
    const alone = inOrder([three(1)], [[1, 'meaning']]);
    expect(canAskLater(alone)).toBe(false);
    expect(askLater(alone)).toBe(alone);
    const shown = inOrder([lesson, three(1)], [[3, 'lesson'], [1, 'meaning']]);
    expect(canAskLater(shown)).toBe(false);
    expect(askLater(shown)).toBe(shown);
  });

  it('is not an answer: the held outcome stays, and undo still goes back past it', () => {
    let study = startStudy(inOrder([three(1), three(2), three(3)], [[1, 'meaning'], [2, 'meaning'], [3, 'meaning']]));
    study = studyAnswer(study, true, at, first).study;
    expect(study.held?.assignmentId).toBe(1);
    const later = studyAskLater(study);
    expect(later.held).toBe(study.held);
    expect(later.history).toBe(study.history);
    expect(ids(later.session)).toEqual([3, 2]);
    expect(ids(studyUndo(later)!.session)).toEqual([1, 2, 3]);
  });
});
