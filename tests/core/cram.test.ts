import { describe, expect, it } from 'vitest';
import {
  capDays, cardsToCap, carryOver, cramLanguage, lessonIsCurrent, lessonPhrases, meaningOf, noteAddedAt, textWords, cramId, cramNotes, cramProblem, cramTag, dayName, daysUntil, finished, fullDate, isAwaitingFinish, isRunning,
  lastMissed, nextRoundAt, parseCram, roundStatus, runningCramTags, wordState, withRound, type Cram,
} from '../../src/core/cram';
import { makeCards } from '../../src/core/cards';
import type { Card, Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const H = 4;
// Wednesday, Nov 18 2026, 9 AM.
const WED = new Date(2026, 10, 18, 9);

const cram = (over: Partial<Cram> = {}): Cram => ({
  id: 'thai-lesson-2026-11-20', name: 'Thai lesson', date: '2026-11-20', createdAt: new Date(2026, 10, 18, 8).toISOString(), addNew: true, rounds: [], ...over,
});
const round = (at: Date, noteIds: string[] = ['a'], missed: string[] = []) => ({ finishedAt: at.toISOString(), noteIds, missed });
const note = (id: string, tags: string[]): Note => ({ ...omniNote(), id, tags });

describe('cramId', () => {
  it('joins the name and date with hyphens, keeping letters of any script', () => {
    expect(cramId('Thai lesson', '2026-11-20')).toBe('thai-lesson-2026-11-20');
    expect(cramId('Interview: Warsaw *_"', '2026-12-01')).toBe('interview-warsaw-2026-12-01');
    expect(cramId('บทเรียน ภาษาไทย', '2026-11-20')).toBe('บทเรียน-ภาษาไทย-2026-11-20');
  });
  it('numbers one already taken', () => {
    expect(cramId('Thai lesson', '2026-11-20', ['thai-lesson-2026-11-20', 'thai-lesson-2026-11-20-2'])).toBe('thai-lesson-2026-11-20-3');
  });
});

describe('cramProblem', () => {
  it('asks for a name and a date from today on', () => {
    expect(cramProblem(' ', '2026-11-20', WED, H)).toMatch(/name/);
    expect(cramProblem('Thai', '', WED, H)).toBe('Choose a date.');
    expect(cramProblem('Thai', '2026-11-17', WED, H)).toBe('Choose today or a day after it.');
    expect(cramProblem('Thai', '2026-11-18', WED, H)).toBeUndefined();
    // At 1 AM on Thursday it's still Wednesday's study day, so Wednesday can be chosen.
    expect(cramProblem('Thai', '2026-11-18', new Date(2026, 10, 19, 1), H)).toBeUndefined();
  });
});

describe('the cram day', () => {
  it('runs until the study day after its date starts', () => {
    expect(isRunning(cram(), WED, H)).toBe(true);
    expect(isRunning(cram(), new Date(2026, 10, 21, 3), H)).toBe(true);
    expect(isRunning(cram(), new Date(2026, 10, 21, 4), H)).toBe(false);
    expect(isAwaitingFinish(cram(), new Date(2026, 10, 21, 4), H)).toBe(true);
    expect(isAwaitingFinish(cram({ finishedAt: WED.toISOString() }), new Date(2026, 10, 21, 4), H)).toBe(false);
    expect(isRunning(cram({ finishedAt: WED.toISOString() }), WED, H)).toBe(false);
  });
  it('counts study days until it', () => {
    expect(daysUntil(cram(), WED, H)).toBe(2);
    expect(daysUntil(cram(), new Date(2026, 10, 20, 2), H)).toBe(1);
    expect(daysUntil(cram(), new Date(2026, 10, 20, 9), H)).toBe(0);
  });
  it('names the day as the screens say it', () => {
    expect(dayName(cram({ date: '2026-11-18' }), WED, H)).toBe('Today');
    expect(dayName(cram({ date: '2026-11-19' }), WED, H)).toBe('Tomorrow');
    expect(dayName(cram(), WED, H)).toBe('Friday');
    expect(dayName(cram({ date: '2026-11-28' }), WED, H)).toBe('Nov 28');
    expect(fullDate(cram())).toBe('Friday, Nov 20');
  });
});

describe('nextRoundAt', () => {
  it('opens the first round at once', () => {
    expect(nextRoundAt(cram(), WED, H)?.getTime()).toBe(WED.getTime());
  });
  it('waits four hours after a round', () => {
    const c = cram({ rounds: [round(new Date(2026, 10, 18, 8))] });
    expect(nextRoundAt(c, WED, H)).toEqual(new Date(2026, 10, 18, 12));
  });
  it('offers no third round in a study day, but the next day', () => {
    const c = cram({ rounds: [round(new Date(2026, 10, 18, 8)), round(new Date(2026, 10, 18, 13))] });
    expect(nextRoundAt(c, new Date(2026, 10, 18, 20), H)).toEqual(new Date(2026, 10, 19, 4));
  });
  it("counts the rounds of the day the round would fall in, not the last one's", () => {
    // Two rounds on Tuesday don't stop one on Wednesday.
    const c = cram({ rounds: [round(new Date(2026, 10, 17, 8)), round(new Date(2026, 10, 17, 18))] });
    expect(nextRoundAt(c, WED, H)!.getTime()).toBeLessThanOrEqual(WED.getTime());
  });
  it('offers rounds on the day itself and none after', () => {
    expect(nextRoundAt(cram(), new Date(2026, 10, 20, 15), H)).toBeDefined();
    expect(nextRoundAt(cram(), new Date(2026, 10, 21, 5), H)).toBeUndefined();
    const late = cram({ rounds: [round(new Date(2026, 10, 21, 1))] });
    expect(nextRoundAt(late, new Date(2026, 10, 21, 2), H)).toBeUndefined();
    expect(nextRoundAt(cram({ finishedAt: WED.toISOString() }), WED, H)).toBeUndefined();
  });
});

describe('roundStatus', () => {
  it('says when the next round is', () => {
    expect(roundStatus(cram(), WED, H)).toEqual({ ready: true, text: 'Round 1 is ready.', action: 'Start round 1' });
    const one = cram({ rounds: [round(new Date(2026, 10, 18, 8))] });
    expect(roundStatus(one, WED, H)).toEqual({ ready: false, text: '1 round done. Next round at 12:00 PM.' });
    expect(roundStatus(one, new Date(2026, 10, 18, 13), H)).toEqual({ ready: true, text: '1 round done. Round 2 is ready.', action: 'Start round 2' });
    const two = cram({ rounds: [round(new Date(2026, 10, 18, 8)), round(new Date(2026, 10, 18, 13))] });
    expect(roundStatus(two, new Date(2026, 10, 18, 20), H).text).toBe('2 rounds done. Next round tomorrow.');
    expect(roundStatus(two, new Date(2026, 10, 21, 5), H).text).toBe('2 rounds done. No rounds left.');
  });
});

describe('words', () => {
  it("are the notes with the cram's tag, as Anki matches tags", () => {
    const notes = [note('a', ['cram::Thai-Lesson-2026-11-20']), note('b', ['cram::other']), note('c', [])];
    expect(cramNotes(cram(), notes).map((n) => n.id)).toEqual(['a']);
    expect(cramTag(cram())).toBe('cram::thai-lesson-2026-11-20');
  });
  it('say how the last round they were in went, else where they came from', () => {
    const c = cram({ rounds: [round(WED, ['a', 'b'], ['a']), round(WED, ['b'], [])], carriedIn: ['c', 'a'] });
    expect(wordState(c, 'a', false)).toBe('missed');
    expect(wordState(c, 'b', false)).toBe('got');
    expect(wordState(c, 'c', false)).toBe('carried');
    expect(wordState(c, 'd', true)).toBe('new');
    expect(wordState(c, 'd', false)).toBe('none');
    expect([...lastMissed(c)]).toEqual([]);
    expect([...lastMissed(withRound(c, round(WED, ['a'], ['a'])))]).toEqual(['a']);
  });
});

describe('finishing and carrying over', () => {
  it('keeps the words not used for the next cram', () => {
    const done = finished(cram(), ['a', 'b', 'c'], ['b'], WED);
    expect(done).toMatchObject({ finishedAt: WED.toISOString(), used: ['b'], unused: ['a', 'c'] });
    const older = { ...finished(cram({ id: 'old' }), ['x'], [], new Date(2026, 10, 10)) };
    expect(carryOver([older, done], new Set(['a', 'b', 'x']))).toEqual({ from: done, noteIds: ['a'] });
    expect(carryOver([{ ...done, carriedTo: 'next' }], new Set(['a']))).toBeUndefined();
    expect(carryOver([cram()], new Set(['a']))).toBeUndefined();
  });
});

describe('runningCramTags', () => {
  it('tags new notes for running crams that add them', () => {
    const crams = [cram(), cram({ id: 'off', addNew: false }), cram({ id: 'over', date: '2026-11-17' })];
    expect(runningCramTags(crams, WED, H)).toEqual(['cram::thai-lesson-2026-11-20']);
  });
});

describe('the review cap', () => {
  const tagged = note('a', ['cram::thai-lesson-2026-11-20']);
  it("is the days until the earliest running cram's day, from tomorrow on", () => {
    expect(capDays([cram()], tagged, WED, H)).toBe(2);
    expect(capDays([cram(), cram({ id: 'thai-lesson-2026-11-20', date: '2026-11-19' })], tagged, WED, H)).toBe(1);
    expect(capDays([cram()], note('b', []), WED, H)).toBeUndefined();
    expect(capDays([cram()], tagged, new Date(2026, 10, 20, 9), H)).toBeUndefined();
    expect(capDays([cram({ finishedAt: WED.toISOString() })], tagged, WED, H)).toBeUndefined();
    expect(capDays([cram()], undefined, WED, H)).toBeUndefined();
  });

  const reviewCard = (id: string, noteId: string, due: Date, over: Partial<Card> = {}): Card => {
    const [c] = makeCards(omniNote(), WED);
    return { ...c, id, noteId, ...over, sched: { ...c.sched, state: 2, due: due.toISOString(), scheduledDays: 10, stability: 20 } };
  };
  it('finds reviews scheduled after the day, and nothing else', () => {
    const late = reviewCard('late', 'a', new Date(2026, 10, 25, 9));
    const onDay = reviewCard('onDay', 'a', new Date(2026, 10, 21, 2)); // 2 AM on the 21st is still the 20th's study day
    const other = reviewCard('other', 'b', new Date(2026, 10, 25, 9));
    const suspended = reviewCard('susp', 'a', new Date(2026, 10, 25, 9), { suspended: true });
    const filtered = reviewCard('filt', 'a', new Date(2026, 10, 25, 9), { filteredDeck: 'Custom Study Session' });
    const [fresh] = makeCards(omniNote(), WED);
    const plan = cardsToCap([cram()], [tagged, note('b', [])], [late, onDay, other, suspended, filtered, { ...fresh, noteId: 'a' }], WED, H);
    expect([...plan.entries()].map(([d, cs]) => [d, cs.map((c) => c.id)])).toEqual([[2, ['late']]]);
  });
});

describe('noteAddedAt', () => {
  it("reads the time from Anki's and Franki's note ids", () => {
    expect(noteAddedAt({ id: '1731000000000' })).toBe(1731000000000);
    const made = new Date(2026, 10, 18, 9).getTime();
    expect(noteAddedAt({ id: `franki:${made.toString(36)}a1b2` })).toBe(made);
    expect(noteAddedAt({ id: 'tsv:Deck:word' })).toBe(0);
  });
});

describe('parseCram', () => {
  it('reads a saved cram and refuses anything else', () => {
    expect(parseCram(JSON.stringify(cram()))).toEqual(cram());
    expect(parseCram(JSON.stringify({ id: 'x', name: 'X', date: '2026-11-20', createdAt: WED.toISOString() }))).toMatchObject({ addNew: true, rounds: [] });
    expect(parseCram('{')).toBeUndefined();
    expect(parseCram('{"id":1}')).toBeUndefined();
  });
});

describe('Read & Listen', () => {
  const thai = (id: string, entry: string, meaning: string): Note => ({ ...omniNote({ Entry: entry, Meaning: meaning }), id });
  const polish = (id: string): Note => ({ ...omniNote({ Entry: 'kot', Meaning: 'cat', Language: 'Polish' }), id, deck: 'Polski' });
  it('takes the language most words are in', () => {
    expect(cramLanguage([thai('a', 'เกือบ', 'almost'), thai('b', 'ค่อยๆ', 'gradually'), polish('c')])).toBe('th');
    expect(cramLanguage([])).toBeUndefined();
  });
  it('practices only studied words in a text', () => {
    const [studied] = makeCards(omniNote(), WED);
    const cards: Card[] = [{ ...studied, noteId: 'a', sched: { ...studied.sched, state: 2 } }, { ...studied, noteId: 'b' }];
    expect(textWords([thai('a', '<b>เกือบ</b>', 'almost'), thai('b', 'ค่อยๆ', 'gradually'), polish('c')], cards, 'th')).toEqual(['เกือบ']);
  });
  it("teaches each word with its meaning in Listen's lesson, and knows when the words changed", () => {
    const notes = [thai('a', 'เกือบ', '<i>almost</i>'), thai('b', 'ค่อยๆ', ''), polish('c'), ...Array.from({ length: 20 }, (_, i) => thai(`n${i}`, `w${i}`, `m${i}`))];
    const phrases = lessonPhrases(notes, 'th');
    expect(phrases[0]).toEqual({ noteId: 'a', text: 'เกือบ', english: 'almost' });
    expect(phrases).toHaveLength(15);
    expect(meaningOf(notes[0])).toBe('almost');
    const c = cram({ lesson: { id: 3, noteIds: ['a', 'b'] } });
    expect(lessonIsCurrent(c, ['b', 'a'])).toBe(true);
    expect(lessonIsCurrent(c, ['a'])).toBe(false);
    expect(lessonIsCurrent(cram(), [])).toBe(false);
  });
});
