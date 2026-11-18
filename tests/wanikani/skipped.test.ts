import { describe, expect, it } from 'vitest';
import { parseState } from '../../src/wanikani/prefs';
import { buildSession, dropItem, startStudy, studyAnswer, studyUndo, type SessionItem } from '../../src/wanikani/session';
import { canSkip, parseSkipped, skipWord, unskipWord, withoutSkipped } from '../../src/wanikani/skipped';
import type { Assignment, Subject } from '../../src/wanikani/subjects';

const subject = (id: number, type: Subject['type'] = 'vocabulary'): Subject => ({
  id, type, level: 1, characters: '猫', meanings: [{ meaning: 'Cat', primary: true, accepted: true }], auxiliaryMeanings: [], readings: [],
  meaningMnemonic: '', contextSentences: [], audio: [], partsOfSpeech: [], componentIds: [], srsId: 1, lessonPosition: 0, hidden: false, url: '',
});
const assignment = (id: number, subjectId: number): Assignment => ({
  id, subjectId, subjectType: 'vocabulary', srsStage: 1, availableAt: null, startedAt: null, unlockedAt: null, passedAt: null, hidden: false,
});
const item = (id: number): SessionItem => ({ assignmentId: id, subjectId: id + 100, srsStage: 1, asksReading: false, lesson: false });

describe('skipped words', () => {
  it('adds a word once, with its first meaning, and takes it off again', () => {
    const once = skipWord([], subject(7), 70);
    expect(once).toEqual([{ subjectId: 7, assignmentId: 70, characters: '猫', meaning: 'Cat' }]);
    expect(skipWord(once, subject(7), 70)).toHaveLength(1);
    expect(unskipWord(once, 7)).toEqual([]);
  });

  it('only lets vocabulary be skipped', () => {
    expect(canSkip(subject(1, 'vocabulary'))).toBe(true);
    expect(canSkip(subject(1, 'kana_vocabulary'))).toBe(true);
    expect(canSkip(subject(1, 'kanji'))).toBe(false);
    expect(canSkip(subject(1, 'radical'))).toBe(false);
    expect(canSkip(undefined)).toBe(false);
  });

  it('leaves skipped words out of the reviews', () => {
    const list = [assignment(1, 10), assignment(2, 20)];
    expect(withoutSkipped(list, skipWord([], subject(20), 2)).map((a) => a.id)).toEqual([1]);
    expect(withoutSkipped(list, [])).toBe(list);
  });

  it('leaves skipped words out of the lessons too, and drops a lesson with its quiz from the session', () => {
    const lessons = [assignment(1, 10), assignment(2, 20)];
    expect(withoutSkipped(lessons, skipWord([], subject(10), 1)).map((a) => a.id)).toEqual([2]);
    const lessonItem = (id: number): SessionItem => ({ ...item(id), lesson: true });
    const study = startStudy(buildSession([lessonItem(1), lessonItem(2)], { mode: 'adjacent', lessonBatch: 5 }, () => 0));
    const gone = study.session.queue[0].assignmentId;
    const after = dropItem(study, gone);
    expect(after.session.queue.every((q) => q.assignmentId !== gone)).toBe(true);
    expect(after.session.queue.map((q) => q.kind)).toEqual(['lesson', expect.any(String)]);
  });

  it('is kept in the state file and read back', () => {
    const words = skipWord([], subject(7), 70);
    expect(parseState(JSON.stringify({ skipped: words })).skipped).toEqual(words);
    expect(parseState(JSON.stringify({})).skipped).toEqual([]);
    expect(parseSkipped([{ subjectId: 'x' }, null, ...words])).toEqual(words);
  });

  it('drops the item from the session and from what undo goes back to, sending nothing', () => {
    const session = buildSession([item(1), item(2), item(3)], { mode: 'adjacent' }, () => 0);
    let study = startStudy(session);
    const first = study.session.queue[0].assignmentId;
    study = studyAnswer(study, true, new Date(2026, 10, 15, 12)).study;
    const skip = study.session.queue[0].assignmentId;
    const after = dropItem(study, skip);
    expect(after.session.queue.map((q) => q.assignmentId)).not.toContain(skip);
    expect(after.session.items[skip]).toBeUndefined();
    expect(after.held).toEqual(study.held);
    const back = studyUndo(after)!;
    expect(back.session.queue.map((q) => q.assignmentId)).toEqual(expect.arrayContaining([first]));
    expect(back.session.queue.map((q) => q.assignmentId)).not.toContain(skip);
  });
});
