import { describe, expect, it } from 'vitest';
import { browseProblem, glob, matchesSearch, parseSearch, rankedWords, readsAnswers, UNSUPPORTED, type SearchNode } from '../../src/core/ankiSearch';
import { nextStudyDayStart } from '../../src/core/day';
import { addCalendarDays } from '../../src/core/day';
import type { Card, Note } from '../../src/core/types';
import { NOW } from '../support/fixtures';

const H = 4;

const note = (over: Partial<Note> = {}): Note =>
  ({ id: 'n', deck: 'Polski::Słownictwo', model: 'Basic', fields: { Front: 'kot', Back: 'cat' }, tags: ['noun', 'animals::pets'], ...over });

let ids = 0;
const card = (over: Partial<Card['sched']> & Partial<Pick<Card, 'suspended' | 'retired' | 'flag' | 'buriedAt' | 'deck' | 'filteredDeck'>> = {}): Card => {
  const { suspended = false, retired = false, flag, buriedAt, deck, filteredDeck, ...sched } = over;
  return {
    id: `c${ids++}`, noteId: 'n', kind: 't0', suspended, retired, flag, buriedAt, deck, filteredDeck,
    sched: { due: NOW.toISOString(), stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 3, lapses: 0, state: 2, lastReview: null, ...sched },
  };
};

/** A plain word matches as a case-blind substring of any field here; Browse's own rule is noteEditing's. */
const ctx = {
  now: NOW,
  dayStartsAtHour: H,
  textMatches: (n: Note, g: ReturnType<typeof glob>) =>
    Object.values(n.fields).some((v) => (g.wild ? new RegExp(g.source, 'iu').test(v) : v.toLowerCase().includes(g.text.toLowerCase()))),
};

const parsed = (q: string): SearchNode => {
  const p = parseSearch(q);
  if (!p.ok) throw new Error(p.error);
  return p.node!;
};
const matches = (q: string, n: Note = note(), cards: Card[] = [card()]) => matchesSearch(parsed(q), n, cards, ctx);
const error = (q: string) => {
  const p = parseSearch(q);
  return p.ok ? undefined : p.error;
};

describe('reading a search', () => {
  it('reads nothing but spaces as no search', () => {
    expect(parseSearch('   ')).toEqual({ ok: true });
  });

  it('ands words, binds or looser than and, and groups with parentheses', () => {
    expect(parsed('a b or c')).toMatchObject({ kind: 'or', parts: [{ kind: 'and' }, { kind: 'text' }] });
    expect(parsed('a (b or c)')).toMatchObject({ kind: 'and', parts: [{ kind: 'text' }, { kind: 'or' }] });
    expect(parsed('a and b')).toMatchObject({ kind: 'and', parts: [{ kind: 'text' }, { kind: 'text' }] });
    expect(parsed('a OR b')).toMatchObject({ kind: 'or' });
    expect(parsed('-tag:leech')).toMatchObject({ kind: 'not', part: { kind: 'tag' } });
    expect(parsed('-(a or b)')).toMatchObject({ kind: 'not', part: { kind: 'or' } });
  });

  it('keeps a quoted phrase in one search, wherever the quotes are, and reads a quoted "or" as a word', () => {
    expect(parsed('"a dog"')).toMatchObject({ kind: 'text', glob: { text: 'a dog' } });
    expect(parsed('"deck:Thai words"')).toMatchObject({ kind: 'deck', glob: { text: 'Thai words' } });
    expect(parsed('deck:"Thai words"')).toMatchObject({ kind: 'deck', glob: { text: 'Thai words' } });
    expect(parsed('"or"')).toMatchObject({ kind: 'text', glob: { text: 'or' } });
  });

  it('reads * and _ as wildcards unless escaped, and an escaped colon as text', () => {
    expect(glob('d*g_')).toEqual({ text: 'd*g_', wild: true, source: 'd.*g.' });
    expect(glob('5\\*2')).toEqual({ text: '5*2', wild: false, source: '5\\*2' });
    expect(parsed('12\\:30')).toMatchObject({ kind: 'text', glob: { text: '12:30' } });
  });

  it('reads the searches it knows, and any other name: as a field', () => {
    expect(parsed('is:DUE')).toEqual({ kind: 'is', state: 'due' });
    expect(parsed('flag:0')).toEqual({ kind: 'flag', flag: 0 });
    expect(parsed('added:7')).toEqual({ kind: 'added', days: 7 });
    expect(parsed('tag:none')).toEqual({ kind: 'noTags' });
    expect(parsed('Front:kot')).toMatchObject({ kind: 'field', field: { text: 'Front' }, value: { text: 'kot' } });
    expect(parsed('Front:')).toMatchObject({ kind: 'field', value: { text: '' } });
  });

  it('says what is wrong with a search it cannot read, and how to fix it', () => {
    expect(error('(tag:verb or tag:noun')).toBe('A "(" has no ")" to close it. Add one, or take the "(" out.');
    expect(error('tag:verb)')).toBe('A ")" has no "(" before it. Take it out, or add the "(".');
    expect(error('()')).toMatch(/nothing inside/);
    expect(error('"a dog')).toMatch(/no closing quote/);
    expect(error('or a')).toMatch(/"or" needs a search on each side/);
    expect(error('a or')).toMatch(/"or" needs a search on each side/);
    expect(error('a or or b')).toMatch(/"or" needs a search on each side/);
    expect(error('a and')).toMatch(/"and" needs a search on each side/);
    expect(error('a -')).toMatch(/"-" needs a search right after it/);
    expect(error('flag:9')).toBe('flag: takes a number from 0 (no flag) to 7.');
    expect(error('is:old')).toBe('is: takes due, new, learn, review, suspended, buried, buried-manually or buried-sibling.');
    expect(error('added:0')).toMatch(/added: takes a number of days/);
    expect(error('deck:')).toBe('deck: needs a deck name, e.g. deck:Polski.');
  });

  it("refuses Anki's searches it doesn't read rather than searching them as a field", () => {
    expect(UNSUPPORTED).toContain('dupe');
    expect(error('dupe:1,kot')).toBe("Franki can't search by dupe: yet. Take it out to search by the rest.");
  });

  it('reads rated:, resched: and prop: as Anki parses them', () => {
    expect(parsed('rated:7')).toEqual({ kind: 'rated', op: '>', days: -7, ease: 'any' });
    expect(parsed('rated:0:1')).toEqual({ kind: 'rated', op: '>', days: -1, ease: 1 });
    expect(parsed('resched:3')).toEqual({ kind: 'rated', op: '>', days: -3, ease: 'manual' });
    expect(parsed('prop:rated>=-7:2')).toEqual({ kind: 'rated', op: '>=', days: -7, ease: 2 });
    expect(parsed('prop:ivl>=21')).toEqual({ kind: 'prop', prop: 'ivl', op: '>=', value: 21 });
    expect(parsed('prop:due<=-1')).toEqual({ kind: 'prop', prop: 'due', op: '<=', value: -1 });
    expect(parsed('prop:r<0.9')).toEqual({ kind: 'prop', prop: 'r', op: '<', value: 0.9 });
    expect(error('rated:7:5')).toBe('The answer button in rated:7:5 is 1 (Again) to 4 (Easy).');
    expect(error('rated:x')).toMatch(/rated: takes a number of days/);
    expect(error('prop:ivl>1.5')).toMatch(/prop:ivl needs a whole number/);
    expect(error('prop:size>3')).toMatch(/prop: takes a property/);
    expect(readsAnswers(parsed('deck:Polski (rated:3 or is:new)'))).toBe(true);
    expect(readsAnswers(parsed('prop:ivl>3'))).toBe(false);
  });

  it("says what Browse can't answer from Franki's own copy of a card", () => {
    expect(browseProblem(parsed('is:due prop:ease<2'))).toMatch(/prop:ease/);
    expect(browseProblem(parsed('-resched:3'))).toMatch(/resched:/);
    expect(browseProblem(parsed('is:buried-sibling'))).toMatch(/is:buried-sibling/);
    expect(browseProblem(parsed('rated:3 prop:ivl>2 is:buried'))).toBeUndefined();
  });

  it('ranks by the plain words a note is meant to hold: not under a "-", and without wildcards', () => {
    expect(rankedWords(parsed('kot (pies or -ryba) d*g deck:Polski'))).toEqual(['kot', 'pies']);
    expect(rankedWords(undefined)).toEqual([]);
  });
});

describe('matching a note', () => {
  it('matches a deck and its subdecks, with wildcards and case aside', () => {
    expect(matches('deck:polski')).toBe(true);
    expect(matches('deck:Polski::Słownictwo')).toBe(true);
    expect(matches('deck:Pol*')).toBe(true);
    expect(matches('deck:Pols')).toBe(false);
    expect(matches('deck:Słownictwo')).toBe(false);
  });

  it("reads a card's own deck and its filtered deck, as Anki's deck: does", () => {
    expect(matches('deck:Deutsch', note(), [card({ deck: 'Deutsch' })])).toBe(true);
    expect(matches('deck:Polski', note(), [card({ deck: 'Deutsch' })])).toBe(false);
    expect(matches('deck:Cram', note(), [card({ filteredDeck: 'Cram' })])).toBe(true);
    expect(matches('deck:Polski', note(), [card({ filteredDeck: 'Cram' })])).toBe(true);
  });

  it('matches a tag and its child tags, tag:none, and the note type', () => {
    expect(matches('tag:NOUN')).toBe(true);
    expect(matches('tag:animals')).toBe(true);
    expect(matches('tag:pets')).toBe(false);
    expect(matches('tag:ani*')).toBe(true);
    expect(matches('tag:none')).toBe(false);
    expect(matches('tag:none', note({ tags: [] }))).toBe(true);
    expect(matches('note:basic')).toBe(true);
    expect(matches('note:Bas')).toBe(false);
  });

  it("matches a field's whole text, case aside, its name with wildcards too, and an empty field", () => {
    expect(matches('front:KOT')).toBe(true);
    expect(matches('front:ko')).toBe(false);
    expect(matches('front:ko*')).toBe(true);
    expect(matches('front:k_t')).toBe(true);
    expect(matches('f*:kot')).toBe(true);
    expect(matches('Front:kot', note({ fields: { Front: '<b>kot</b>', Back: '' } }))).toBe(true);
    expect(matches('back:', note({ fields: { Front: 'kot', Back: '' } }))).toBe(true);
    expect(matches('Missing:kot')).toBe(false);
  });

  it('combines words with and, or and not', () => {
    expect(matches('kot cat')).toBe(true);
    expect(matches('kot dog')).toBe(false);
    expect(matches('kot or dog')).toBe(true);
    expect(matches('-dog')).toBe(true);
    expect(matches('-(kot or dog)')).toBe(false);
    expect(matches('c*t')).toBe(true);
  });

  it("reads a card's state and flag, a card that can be studied today as is:due", () => {
    const tomorrow = addCalendarDays(NOW, 1).toISOString();
    expect(matches('is:new', note(), [card({ state: 0 })])).toBe(true);
    expect(matches('is:new', note(), [card({ state: 0, suspended: true })])).toBe(true);
    expect(matches('is:learn', note(), [card({ state: 3 })])).toBe(true);
    expect(matches('is:review', note(), [card({ state: 3 })])).toBe(true);
    expect(matches('is:review', note(), [card({ state: 1 })])).toBe(false);
    expect(matches('is:due', note(), [card()])).toBe(true);
    expect(matches('is:due', note(), [card({ due: tomorrow })])).toBe(false);
    expect(matches('is:due', note(), [card({ suspended: true })])).toBe(false);
    expect(matches('is:due', note(), [card({ state: 0 })])).toBe(false);
    expect(matches('is:suspended', note(), [card({ suspended: true })])).toBe(true);
    expect(matches('is:buried', note(), [card({ buriedAt: NOW.toISOString() })])).toBe(true);
    expect(matches('is:due', note(), [card({ buriedAt: NOW.toISOString() })])).toBe(false);
    // Buried on an earlier study day: Anki has unburied it.
    expect(matches('is:buried', note(), [card({ buriedAt: addCalendarDays(NOW, -1).toISOString() })])).toBe(false);
    expect(matches('flag:1', note(), [card({ flag: 1 })])).toBe(true);
    expect(matches('flag:0', note(), [card({ flag: 1 })])).toBe(false);
    expect(matches('flag:0', note(), [card()])).toBe(true);
  });

  it('needs one card to match the whole search, and leaves retired cards out', () => {
    const cards = [card({ state: 0 }), card({ flag: 1 })];
    expect(matches('is:new', note(), cards)).toBe(true);
    expect(matches('flag:1', note(), cards)).toBe(true);
    expect(matches('is:new flag:1', note(), cards)).toBe(false);
    expect(matches('-is:suspended', note(), [card({ suspended: true }), card()])).toBe(true);
    expect(matches('is:suspended', note(), [card({ suspended: true, retired: true }), card()])).toBe(false);
  });

  it('finds no card state in a note with no cards, and finds it under a "-"', () => {
    expect(matches('is:new', note(), [])).toBe(false);
    expect(matches('-is:new', note(), [])).toBe(true);
    expect(matches('kot', note(), [])).toBe(true);
  });

  it('reads added:N as added in the last N study days, today being 1', () => {
    // A note's Anki id is the moment it was added, in milliseconds.
    const added = (d: Date) => note({ id: String(d.getTime()) });
    const thisMorning = new Date(2026, 10, 11, 5);
    const lastNight = new Date(2026, 10, 11, 2); // before 4 AM: the study day before
    expect(matches('added:1', added(thisMorning))).toBe(true);
    expect(matches('added:1', added(lastNight))).toBe(false);
    expect(matches('added:2', added(lastNight))).toBe(true);
    expect(matches('added:2', added(new Date(2026, 10, 9, 23)))).toBe(false);
  });
});

describe("rated: and prop: on Franki's copy of a card", () => {
  const next = nextStudyDayStart(NOW, H).getTime();
  const answered = (at: number, ease: number) => ({ ...ctx, answersOf: () => [{ at, ease }] });
  const rated = (q: string, at: number, ease = 3) => matchesSearch(parsed(q), note(), [card()], answered(at, ease));
  it('counts answers back from the next study day, by button', () => {
    expect(rated('rated:1', next - 1000)).toBe(true);
    expect(rated('rated:1', next - 86_400_000 - 1000)).toBe(false);
    expect(rated('rated:2', next - 86_400_000 - 1000)).toBe(true);
    expect(rated('rated:2:1', next - 1000, 3)).toBe(false);
    expect(rated('rated:2:1', next - 1000, 1)).toBe(true);
    expect(matches('rated:30')).toBe(false); // no answers known
  });
  it('compares interval, reps, lapses, due and FSRS values', () => {
    const review = card({ state: 2, scheduledDays: 30, reps: 5, lapses: 2, stability: 40, difficulty: 6.4, due: addCalendarDays(NOW, 3).toISOString() });
    const m = (q: string, c: Card = review) => matchesSearch(parsed(q), note(), [c], { ...ctx, retrievabilityOf: () => 0.8 });
    expect(m('prop:ivl>=21')).toBe(true);
    expect(m('prop:ivl>30')).toBe(false);
    expect(m('prop:reps=5 prop:lapses>1')).toBe(true);
    expect(m('prop:due=3')).toBe(true);
    expect(m('prop:due<3')).toBe(false);
    expect(m('prop:s>39 prop:d>0.5')).toBe(true);
    expect(m('prop:r<0.9')).toBe(true);
    expect(m('prop:ivl>0', card({ state: 0 }))).toBe(false);
  });
});

