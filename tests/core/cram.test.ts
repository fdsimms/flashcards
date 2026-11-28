import { describe, expect, it } from 'vitest';
import {
  addableNotes, capDays, cardsToCap, carryOver, cramLanguage, lessonIsCurrent, lessonPhrases, meaningOf, noteAddedAt, textWords, cramId, cramNotes, cramProblem, cramTag, dayName, daysUntil, finished, fullDate, isAwaitingFinish, isDismissedToday, isRunning,
  afterCardsAsked, SOLID_PASSES, standInName, themeTopic, withThemes, dayChoices, lastCramLanguage, lastMissed, missedLately, parseCram, pendingRequests, practiceLabel, practiceProgress, practiceSummary, practiceWords, runningCramTags, searchNotes,
  cramLessonPhrases, LESSON_TALK_LINES, practiceOrder, preparedLines, cramTextTopic, talkLessonLines, talkScene, talkSummary, withoutTalk, withTalkAsked, withTalkStory, type CramTalk,
  withCapture, withoutCapture, withoutQuestion, withoutRequest, withQuestion, withQuestionAsked, withRequest, wordState, withRound, type Cram,
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
  it('follows a rollover after noon', () => {
    // With the day starting at 2 PM, 1 PM on the 20th is still the 19th's study day.
    expect(daysUntil(cram(), new Date(2026, 10, 20, 13), 14)).toBe(1);
    expect(daysUntil(cram(), new Date(2026, 10, 20, 15), 14)).toBe(0);
    expect(isRunning(cram(), new Date(2026, 10, 21, 13), 14)).toBe(true);
    expect(isRunning(cram(), new Date(2026, 10, 21, 14), 14)).toBe(false);
  });
  it('names the day as the screens say it', () => {
    expect(dayName(cram({ date: '2026-11-18' }), WED, H)).toBe('Today');
    expect(dayName(cram({ date: '2026-11-19' }), WED, H)).toBe('Tomorrow');
    expect(dayName(cram(), WED, H)).toBe('Friday');
    expect(dayName(cram({ date: '2026-11-28' }), WED, H)).toBe('Nov 28');
    expect(fullDate(cram())).toBe('Friday, Nov 20');
  });
});

describe('practice', () => {
  it('can start any time, as often as wanted: the words not solid yet, else all of them', () => {
    const ids = ['a', 'b', 'c'];
    expect(practiceWords(cram(), ids)).toEqual(ids);
    expect(practiceLabel(cram(), ids)).toBe('Practice 3 words');
    expect(practiceSummary(cram(), ids)).toBe('Not practiced yet.');
    // Three passes in an hour: nothing waits between them.
    const three = cram({
      rounds: [round(new Date(2026, 10, 18, 8), ids, ['a']), round(new Date(2026, 10, 18, 8, 20), ids, ['a', 'b']), round(new Date(2026, 10, 18, 8, 40), ['a', 'b'], ['a'])],
    });
    // c was got the first time in both passes it was in; b only in the last, so it isn't solid yet.
    expect(practiceProgress(three, ids)).toEqual({ solid: ['c'], toGo: ['a', 'b'] });
    expect(practiceWords(three, ids)).toEqual(['a', 'b']);
    expect(practiceLabel(three, ids)).toBe('Practice 2 words');
    expect(practiceSummary(three, ids)).toBe('1 of 3 words solid.');
    const all = withRound(withRound(three, round(WED, ['a', 'b'], [])), round(WED, ['a'], []));
    expect(practiceWords(all, ids)).toEqual(ids);
    expect(practiceLabel(all, ids)).toBe('Practice all 3 again');
    expect(practiceSummary(cram(), [])).toBe('No words yet.');
    // A cram with phrases and no words says so on every screen that shows the line (Today, the list, the cram).
    expect(practiceSummary({ ...cram(), phrases: [{ text: 'Dzień dobry', english: 'Good morning' }] }, [])).toBe('1 phrase.');
  });
  it(`takes ${SOLID_PASSES} clean passes in a row to count a word as solid`, () => {
    expect(SOLID_PASSES).toBe(2);
    expect(practiceProgress(cram({ rounds: [round(WED, ['a'], [])] }), ['a']).solid).toEqual([]);
    expect(practiceProgress(cram({ rounds: [round(WED, ['a'], []), round(WED, ['a'], [])] }), ['a']).solid).toEqual(['a']);
    // A miss in the latest pass undoes it, and so does one in the pass before.
    expect(practiceProgress(cram({ rounds: [round(WED, ['a'], []), round(WED, ['a'], []), round(WED, ['a'], ['a'])] }), ['a']).solid).toEqual([]);
    expect(practiceProgress(cram({ rounds: [round(WED, ['a'], ['a']), round(WED, ['a'], [])] }), ['a']).solid).toEqual([]);
  });
  it('counts a word added after the last pass as still to go', () => {
    const c = cram({ rounds: [round(WED, ['a'], []), round(WED, ['a'], [])] });
    expect(practiceProgress(c, ['a', 'new'])).toEqual({ solid: ['a'], toGo: ['new'] });
  });
  it('names a cram started without a topic after the theme it takes, and asks for free ideas until then', () => {
    const talk = { title: 'My weekend at the beach', questions: [] };
    const untitled = cram({ name: standInName('Thai'), untitled: true });
    expect(untitled.name).toBe('Thai lesson');
    expect(standInName(undefined)).toBe('Lesson');
    expect(themeTopic(untitled)).toBe('');
    const named = withThemes(untitled, [talk]);
    expect(named).toMatchObject({ name: 'My weekend at the beach', themes: [talk], id: untitled.id });
    expect(named.untitled).toBeUndefined();
    expect(themeTopic(named)).toBe('My weekend at the beach');
    // A cram named by its owner keeps its name.
    expect(withThemes(cram(), [talk])).toMatchObject({ name: 'Thai lesson', themes: [talk] });
    expect(themeTopic(cram())).toBe('Thai lesson');
  });
  it('keeps several themes in order, replacing one with the same title, and names an untitled cram after the first', () => {
    const a = { title: 'A', questions: [] };
    const b = { title: 'B', questions: [] };
    const b2 = { title: 'B', questions: [{ text: 'q', english: '' }] };
    expect(withThemes(cram({ untitled: true, name: 'Thai lesson' }), [a, b])).toMatchObject({ name: 'A', themes: [a, b] });
    expect(withThemes(cram({ themes: [a, b] }), [b2]).themes).toEqual([a, b2]);
    expect(withThemes(cram(), [])).toEqual(cram());
  });
  it('reads a cram saved with its one theme as a list of one', () => {
    const talk = { title: 'A', questions: [] };
    const json = JSON.stringify({ ...cram(), theme: talk });
    expect(parseCram(json)?.themes).toEqual([talk]);
    expect(parseCram(json)).not.toHaveProperty('theme');
  });
});

describe('planning', () => {
  it('keeps questions for the tutor, once each, and checks them off', () => {
    const one = withQuestion(cram(), '  How do I say   "encore"? ', 'q1')!;
    expect(one.questions).toEqual([{ id: 'q1', text: 'How do I say "encore"?' }]);
    expect(withQuestion(one, 'how do i say "encore"?', 'q2')).toBeUndefined();
    expect(withQuestion(one, '   ', 'q3')).toBeUndefined();
    expect(withQuestionAsked(one, 'q1', true).questions).toEqual([{ id: 'q1', text: 'How do I say "encore"?', asked: true }]);
    expect(withoutQuestion(one, 'q1').questions).toEqual([]);
  });
  it('keeps what was typed in the lesson, once each', () => {
    const one = withCapture(cram(), ' ประหม่า ')!;
    expect(one.captured).toEqual(['ประหม่า']);
    expect(withCapture(one, 'ประหม่า')).toBeUndefined();
    expect(withoutCapture(one, 'ประหม่า').captured).toEqual([]);
  });
  it("turns the lesson's jottings into cards being written, keeping what changed meanwhile", () => {
    const sent = withCapture(withCapture(cram(), 'encore')!, 'bow')!;
    // Jotted after the request went out, while it was on its way.
    const now = withCapture(sent, 'ประหม่า')!;
    const next = afterCardsAsked(now, [{ capture: 'encore', word: { text: 'อังกอร์', english: 'encore' } }]);
    expect(next.captured).toEqual(['bow', 'ประหม่า']);
    expect(next.requested).toEqual([{ text: 'อังกอร์', english: 'encore' }]);
  });
  it('shows a card asked of Claude until a note with the word is in the cram', () => {
    const asked = withRequest(withRequest(cram(), { text: 'เวที', english: 'stage' }), { text: 'ปรบมือ', english: 'to clap' });
    expect(withRequest(asked, { text: 'เวที', english: 'a stage' }).requested).toHaveLength(2);
    const inCram = [{ ...omniNote({ Entry: '<b>เวที</b>', Meaning: 'stage' }), id: 'n' }];
    expect(pendingRequests(asked, inCram)).toEqual([{ text: 'ปรบมือ', english: 'to clap' }]);
    expect(pendingRequests(withoutRequest(asked, 'ปรบมือ'), inCram)).toEqual([]);
  });
  it('finds notes by the word, then by a whole word of the meaning', () => {
    const n = (id: string, entry: string, meaning: string): Note => ({ ...omniNote({ Entry: entry, Meaning: meaning }), id });
    const notes = [n('1', 'อีกครั้ง', 'once more, again'), n('2', 'พูดอีกครั้งได้ไหม', 'Could you say that again?'), n('3', 'against', 'x'), n('4', 'ไวโอลิน', 'violin')];
    expect(searchNotes(notes, 'again', 10).map((x) => x.id)).toEqual(['3', '2', '1']);
    expect(searchNotes(notes, 'อีกครั้ง', 10).map((x) => x.id)).toEqual(['1', '2']);
    expect(searchNotes(notes, 'VIOLIN', 10).map((x) => x.id)).toEqual(['4']);
    expect(searchNotes(notes, 'a.*', 10)).toEqual([]);
    expect(searchNotes(notes, '  ', 10)).toEqual([]);
    expect(searchNotes(notes, 'again', 1)).toHaveLength(1);
  });
  it('offers today, tomorrow and the next three days, by study day', () => {
    expect(dayChoices(WED, H)).toEqual([
      { label: 'Today', date: '2026-11-18' }, { label: 'Tomorrow', date: '2026-11-19' }, { label: 'Fri', date: '2026-11-20' }, { label: 'Sat', date: '2026-11-21' }, { label: 'Sun', date: '2026-11-22' },
    ]);
    // At 1 AM it's still Tuesday's study day.
    expect(dayChoices(new Date(2026, 10, 18, 1), H)[0]).toEqual({ label: 'Today', date: '2026-11-17' });
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
    const crams = [cram({ language: 'th' }), cram({ id: 'off', addNew: false, language: 'th' }), cram({ id: 'over', date: '2026-11-17', language: 'th' })];
    expect(runningCramTags(crams, [], 'th', WED, H)).toEqual(['cram::thai-lesson-2026-11-20']);
  });
  it("tags only crams in the note's own language, reading a cram's from its words when none was picked", () => {
    const thaiWord = { ...omniNote({ Entry: 'ไวโอลิน', Meaning: 'violin' }), id: 't', tags: ['cram::by-words'] };
    const crams = [cram({ id: 'polish', language: 'pl' }), cram({ id: 'by-words' }), cram({ id: 'empty' })];
    expect(runningCramTags(crams, [thaiWord], 'th', WED, H)).toEqual(['cram::by-words']);
    expect(runningCramTags(crams, [thaiWord], 'pl', WED, H)).toEqual(['cram::polish']);
    // A note in no language Read & Listen knows joins only a cram that has none either.
    expect(runningCramTags(crams, [thaiWord], undefined, WED, H)).toEqual(['cram::empty']);
  });
});

describe('suggestions for a new cram', () => {
  const thai = (id: string): Note => ({ ...omniNote({ Entry: 'เกือบ', Meaning: 'almost' }), id });
  const polish = (id: string): Note => ({ ...omniNote({ Entry: 'kot', Meaning: 'cat', Language: 'Polish' }), id, deck: 'Polski' });
  it('starts in the language of the cram made last', () => {
    const older = cram({ id: 'a', language: 'pl', createdAt: '2026-11-01T00:00:00.000Z' });
    const newer = cram({ id: 'b', language: 'th', createdAt: '2026-11-10T00:00:00.000Z' });
    expect(lastCramLanguage([newer, older], [])).toBe('th');
    expect(lastCramLanguage([cram({ id: 'c', createdAt: '2026-11-12T00:00:00.000Z' }), older], [])).toBe('pl');
    expect(lastCramLanguage([], [])).toBeUndefined();
  });
  it("offers the words missed lately in the cram's language, most missed first", () => {
    const rows = [{ note: thai('a'), misses: 1 }, { note: thai('b'), misses: 3 }, { note: polish('c'), misses: 5 }, { note: thai('a'), misses: 2 }, { note: thai('d'), misses: 9 }];
    expect(missedLately(rows, 'th', ['d'])).toEqual(['a', 'b']);
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
    return { ...c, id, noteId, ...over, sched: { ...c.sched, state: 2, due: due.toISOString(), scheduledDays: 10, stability: 20, lastReview: new Date(2026, 10, 10).toISOString() } };
  };
  it('finds reviews scheduled after the day, and nothing else', () => {
    const late = reviewCard('late', 'a', new Date(2026, 10, 25, 9));
    const onDay = reviewCard('onDay', 'a', new Date(2026, 10, 21, 2)); // 2 AM on the 21st is still the 20th's study day
    const other = reviewCard('other', 'b', new Date(2026, 10, 25, 9));
    const suspended = reviewCard('susp', 'a', new Date(2026, 10, 25, 9), { suspended: true });
    const filtered = reviewCard('filt', 'a', new Date(2026, 10, 25, 9), { filteredDeck: 'Custom Study Session' });
    const neverAnswered = reviewCard('never', 'a', new Date(2026, 10, 25, 9));
    neverAnswered.sched.lastReview = null;
    const [fresh] = makeCards(omniNote(), WED);
    const plan = cardsToCap([cram()], [tagged, note('b', [])], [late, onDay, other, suspended, filtered, neverAnswered, { ...fresh, noteId: 'a' }], WED, H);
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

describe('isDismissedToday', () => {
  it('holds for the study day it was dismissed on and lapses at the next day start', () => {
    const c = cram({ dismissedOn: '2026-11-18' });
    expect(isDismissedToday(c, WED, H)).toBe(true);
    expect(isDismissedToday(c, new Date(2026, 10, 19, 1), H)).toBe(true);
    expect(isDismissedToday(c, new Date(2026, 10, 19, 5), H)).toBe(false);
    expect(isDismissedToday(cram(), WED, H)).toBe(false);
  });
});

describe('parseCram', () => {
  it('keeps a cram\'s register and drops one it doesn\'t know', () => {
    expect(parseCram(JSON.stringify({ ...cram(), register: 'formal' }))?.register).toBe('formal');
    expect(parseCram(JSON.stringify({ ...cram(), register: 'slang' }))?.register).toBeUndefined();
  });

  it('reads a saved cram and refuses anything else', () => {
    expect(parseCram(JSON.stringify(cram()))).toEqual(cram());
    expect(parseCram(JSON.stringify({ id: 'x', name: 'X', date: '2026-11-20', createdAt: WED.toISOString() }))).toMatchObject({ addNew: true, rounds: [] });
    expect(parseCram(JSON.stringify({ ...cram(), language: 'fr' }))?.language).toBe('fr');
    expect(parseCram(JSON.stringify({ ...cram(), language: 'xx' }))?.language).toBeUndefined();
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
  it('offers only notes in the cram\'s language, keeping any already in it', () => {
    const all = [thai('a', 'เกือบ', 'almost'), thai('b', 'ค่อยๆ', 'gradually'), polish('c')];
    expect(addableNotes(all, [all[0]]).map((n) => n.id)).toEqual(['a', 'b']);
    expect(addableNotes(all, [all[0], all[2]]).map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(addableNotes(all, [])).toEqual(all);
    expect(addableNotes(all, [], 'pl').map((n) => n.id)).toEqual(['c']);
    expect(addableNotes(all, [all[0]], 'pl').map((n) => n.id)).toEqual(['a', 'c']);
  });
  it('never offers a skill card, but keeps one already in the cram', () => {
    const skill = { ...thai('s', 'กาแฟ', 'coffee'), tags: ['skill'] };
    const word = thai('a', 'เกือบ', 'almost');
    expect(addableNotes([skill, word], [word]).map((n) => n.id)).toEqual(['a']);
    expect(addableNotes([skill, word], []).map((n) => n.id)).toEqual(['a']);
    expect(addableNotes([skill, word], [skill, word], 'th').map((n) => n.id)).toEqual(['s', 'a']);
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
    expect(lessonPhrases([thai('long', 'เกือบ', 'x'.repeat(201))], 'th')).toEqual([]);
    expect(meaningOf(notes[0])).toBe('almost');
    const c = cram({ lesson: { id: 3, noteIds: ['a', 'b'] } });
    expect(lessonIsCurrent(c, ['b', 'a'])).toBe(true);
    expect(lessonIsCurrent(c, ['a'])).toBe(false);
    expect(lessonIsCurrent(cram(), [])).toBe(false);
    // The talking points' lines it teaches count too.
    const withLines = cram({ lesson: { id: 3, noteIds: ['a'], lines: ['ครูวิ่งไหมครับ'] } });
    expect(lessonIsCurrent(withLines, ['a'], ['ครูวิ่งไหมครับ'])).toBe(true);
    expect(lessonIsCurrent(withLines, ['a'])).toBe(false);
    expect(lessonIsCurrent(c, ['a', 'b'], ['ครูวิ่งไหมครับ'])).toBe(false);
  });
});

const talk = (title: string, over: Partial<CramTalk> = {}): CramTalk => ({
  title,
  questions: [{ text: `${title} ask 1`, english: 'a1' }, { text: `${title} ask 2`, english: 'a2' }],
  expects: [
    { question: { text: `${title} q1`, english: 'q1' }, answer: { text: `${title} answer 1`, english: 'r1' } },
    { question: { text: `${title} q2`, english: 'q2' }, answer: { text: `${title} answer 2`, english: 'r2' } },
  ],
  story: { text: `${title} story`, english: 's' },
  ...over,
});

describe('talking points', () => {
  const thai = (id: string, entry: string): Note => ({ ...omniNote({ Entry: entry, Meaning: `${entry} meaning` }), id });
  it('orders the words missed last, then the ones not solid, then the solid ones', () => {
    const notes = ['a', 'b', 'c', 'd'].map((id) => thai(id, id));
    const c = cram({ rounds: [round(WED, ['a', 'b', 'c', 'd'], ['c']), round(WED, ['a', 'b', 'c', 'd'], ['d'])] });
    // a and b were got twice (solid), c was missed once and got since (not solid), d was missed last.
    expect(practiceOrder(c, notes).map((n) => n.id)).toEqual(['d', 'c', 'a', 'b']);
  });
  it("teaches each talking point's first question and first answer, then the rest, up to the limit", () => {
    const c = cram({ themes: [talk('A'), talk('B')] });
    expect(talkLessonLines(c).map((l) => l.text)).toEqual(['A ask 1', 'B ask 1', 'A answer 1', 'B answer 1', 'A ask 2']);
    expect(talkLessonLines(c)).toHaveLength(LESSON_TALK_LINES);
    // A talking point kept before there were answers, or a line too long to send, is fine.
    const old = cram({ themes: [{ title: 'Old', questions: [{ text: 'x'.repeat(201), english: 'long' }, { text: 'ok', english: 'ok' }] }] });
    expect(talkLessonLines(old)).toEqual([{ text: 'ok', english: 'ok' }]);
    expect(talkLessonLines(cram())).toEqual([]);
  });
  it("makes Listen's lesson from the talking points' lines, then the shakiest words, within the limit", () => {
    const notes = Array.from({ length: 14 }, (_, i) => thai(`n${i}`, `w${i}`));
    const c = cram({ themes: [talk('A')], rounds: [round(WED, ['n0', 'n13'], ['n13'])] });
    const got = cramLessonPhrases(c, notes, 'th');
    expect(got.lines).toEqual(['A ask 1', 'A answer 1', 'A ask 2', 'A answer 2']);
    expect(got.noteIds[0]).toBe('n13');
    expect(got.phrases).toHaveLength(15);
    expect(got.noteIds).toHaveLength(11);
  });
  it("sets a lesson or a rehearsal in the one talking point, else what the cram is for, else the first one's title", () => {
    expect(talkScene(cram({ themes: [talk('Race day')] }))).toBe('Race day');
    expect(talkScene(cram({ name: 'Half marathon', themes: [talk('A'), talk('B')] }))).toBe('Half marathon');
    expect(talkScene(cram({ name: 'Thai lesson', untitled: true, themes: [talk('A'), talk('B')] }))).toBe('A');
    expect(talkScene(cram({ name: 'Thai lesson' }))).toBe('Thai lesson');
  });
  it("writes Read a text on what the cram is for, and leaves an untitled cram with no talking point to the caller's own idea", () => {
    expect(cramTextTopic(cram({ name: 'Half marathon' }))).toBe('Half marathon');
    expect(cramTextTopic(cram({ themes: [talk('Race day')] }))).toBe('Race day');
    expect(cramTextTopic(cram({ name: 'Thai lesson', untitled: true, themes: [talk('A'), talk('B')] }))).toBe('A');
    expect(cramTextTopic(cram({ name: 'Thai lesson', untitled: true }))).toBeUndefined();
    expect(cramTextTopic(cram({ name: `  ${'x'.repeat(200)}  ` }))).toHaveLength(150);
  });
  it('says what a talking point holds', () => {
    expect(talkSummary(talk('A'))).toBe('2 to ask · 2 they may ask · your story');
    expect(talkSummary({ questions: [1], expects: null, story: null })).toBe('1 to ask');
  });
  it('lists what was prepared for the tutor, labeled', () => {
    const lines = preparedLines(cram({ themes: [talk('A', { expects: [talk('A').expects![0]], questions: [talk('A').questions[0]] })] }));
    expect(lines).toEqual(['Topic: A', 'You ask: A ask 1', 'They may ask you: A q1 (your answer: A answer 1)', 'Your story: A story']);
    expect(preparedLines(cram())).toEqual([]);
  });
  it('takes a talking point out, edits its story and checks off its questions', () => {
    const c = cram({ themes: [talk('A', { unknown: [{ word: 'x', english: '' }] }), talk('B')] });
    expect(withoutTalk(c, 'A').themes?.map((t) => t.title)).toEqual(['B']);
    const edited = withTalkStory(c, 'A', { text: 'new', english: 'New.' }).themes![0];
    expect(edited.story).toEqual({ text: 'new', english: 'New.' });
    expect(edited.unknown).toBeUndefined();
    const asked = withTalkAsked(c, 'A', 'A ask 1', true);
    expect(asked.themes![0].asked).toEqual(['A ask 1']);
    expect(withTalkAsked(asked, 'A', 'A ask 1', false).themes![0].asked).toEqual([]);
    expect(asked.themes![1].asked).toBeUndefined();
  });
});
