import { describe, expect, it } from 'vitest';
import { boostCap, boostFor, SKILL_WORDS_PERCENT, noteHasAnyTag, noteHasTag, parsePriorityNumber, planPriorityStamps, priorityMatchCount, prioritySettings, suggestTags, tagCounts } from '../../src/core/priority';
import type { DeckSettings, Note } from '../../src/core/types';

const note = (id: string, deck: string, tags: string[]): Note => ({ id, deck, model: 'Basic', fields: {}, tags });
const NOW = new Date(2026, 10, 12, 12);
const on = (extra: DeckSettings = {}): DeckSettings => ({ priorityFirst: true, priorityTag: 'italki', ...extra });

describe('prioritySettings', () => {
  it('is off until switched on, with the defaults', () => {
    expect(prioritySettings('Thai', new Map())).toMatchObject({ on: false, tags: [], days: 14, percent: 50 });
  });
  it('follows the nearest deck that has its own switch', () => {
    const all = new Map<string, DeckSettings>([['Thai', on()], ['Thai::Food', { priorityFirst: false }]]);
    expect(prioritySettings('Thai::Food::Fruit', all).on).toBe(false);
    expect(prioritySettings('Thai::Verbs', all)).toMatchObject({ on: true, owner: 'Thai', tags: ['italki'] });
  });
});

describe('noteHasTag', () => {
  it('matches like Anki: case-insensitive, and a tag also matches its children', () => {
    expect(noteHasTag(note('1', 'Thai', ['ITALKI']), 'italki')).toBe(true);
    expect(noteHasTag(note('1', 'Thai', ['italki::nov']), 'italki')).toBe(true);
    expect(noteHasTag(note('1', 'Thai', ['italkis']), 'italki')).toBe(false);
    expect(noteHasTag(note('1', 'Thai', ['italki']), ' ')).toBe(false);
  });
});

describe('several tags', () => {
  it('reads a setting saved as a space-separated list, and a single old tag', () => {
    expect(prioritySettings('Thai', new Map([['Thai', on({ priorityTag: 'italki  lesson ITALKI' })]])).tags).toEqual(['italki', 'lesson']);
    expect(prioritySettings('Thai', new Map([['Thai', on()]])).tags).toEqual(['italki']);
  });
  it('matches a note with any of them', () => {
    expect(noteHasAnyTag(note('1', 'Thai', ['lesson']), ['italki', 'lesson'])).toBe(true);
    expect(noteHasAnyTag(note('1', 'Thai', ['verb']), ['italki', 'lesson'])).toBe(false);
    expect(noteHasAnyTag(note('1', 'Thai', ['italki']), [])).toBe(false);
  });
  it('boosts and stamps notes with either tag', () => {
    const notes = [note('a', 'Thai', ['italki']), note('b', 'Thai', ['lesson']), note('c', 'Thai', ['verb'])];
    const settings = new Map([['Thai', on({ priorityTag: 'italki lesson' })]]);
    expect([...boostFor({ notes, settings, now: NOW })('Thai')!.noteIds].sort()).toEqual(['a', 'b']);
    expect(Object.keys(planPriorityStamps(notes, settings, NOW).get('Thai')!.priorityStamps!).sort()).toEqual(['a', 'b']);
  });
  it('counts the notes in the deck the tags would put first', () => {
    const notes = [note('a', 'Thai', ['italki']), note('b', 'Thai::Food', ['lesson']), note('c', 'Polski', ['italki']), note('d', 'Thai', [])];
    expect(priorityMatchCount(notes, 'Thai', ['italki', 'lesson'])).toBe(2);
    expect(priorityMatchCount(notes, 'Thai', [])).toBe(0);
  });
});

describe('suggestTags', () => {
  const notes = [note('a', 'Thai', ['italki', 'noun']), note('b', 'Thai', ['italki', 'verb']), note('c', 'Thai', ['Noun']), note('d', 'Thai', ['irregular'])];
  it('lists tags containing the text, most used first, counting each spelling once', () => {
    expect(suggestTags(tagCounts(notes), 'i', [], 5)).toEqual([{ tag: 'italki', count: 2 }, { tag: 'irregular', count: 1 }]);
    expect(suggestTags(tagCounts(notes), 'OUN', [], 5)).toEqual([{ tag: 'noun', count: 2 }]);
  });
  it('leaves out chosen tags, lists the most used for an empty query, and stops at the limit', () => {
    expect(suggestTags(tagCounts(notes), '', ['Italki'], 2)).toEqual([{ tag: 'noun', count: 2 }, { tag: 'irregular', count: 1 }]);
  });
});

describe('boostCap', () => {
  it('is a percent of the room, rounded up, at least 1', () => {
    expect(boostCap(50, 20)).toBe(10);
    expect(boostCap(50, 5)).toBe(3);
    expect(boostCap(1, 20)).toBe(1);
    expect(boostCap(50, 0)).toBe(1);
    expect(boostCap(50, Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('boostFor', () => {
  const notes = [note('a', 'Thai', ['italki']), note('b', 'Thai', []), note('c', 'Thai::Food', ['italki']), note('d', 'Polski', ['italki'])];
  it('boosts tagged notes inside the deck, and nothing when off', () => {
    const settings = new Map([['Thai', on()]]);
    expect([...boostFor({ notes, settings, now: NOW })('Thai')!.noteIds].sort()).toEqual(['a', 'c']);
    expect([...boostFor({ notes, settings, now: NOW })('Thai::Food')!.noteIds]).toEqual(['c']);
    expect(boostFor({ notes, settings, now: NOW })('Polski')).toBeUndefined();
    expect(boostFor({ notes, settings: new Map(), now: NOW })('Thai')).toBeUndefined();
  });
  it('ends N days after the tag was first seen', () => {
    const stamps = { a: new Date(2026, 10, 1, 12).toISOString(), c: new Date(2026, 9, 20, 12).toISOString() };
    const settings = new Map([['Thai', on({ priorityStamps: stamps, priorityDays: 14 })]]);
    expect([...boostFor({ notes, settings, now: NOW })('Thai')!.noteIds]).toEqual(['a']);
  });
  it('does nothing without a tag', () => {
    expect(boostFor({ notes, settings: new Map([['Thai', { priorityFirst: true }]]), now: NOW })('Thai')).toBeUndefined();
  });
});

describe('planPriorityStamps', () => {
  const notes = [note('a', 'Thai', ['italki']), note('b', 'Thai', [])];
  it('stamps a tagged note once and keeps its date', () => {
    const first = planPriorityStamps(notes, new Map([['Thai', on()]]), NOW);
    const stamped = first.get('Thai')!;
    expect(stamped.priorityStamps).toEqual({ a: NOW.toISOString() });
    expect(planPriorityStamps(notes, new Map([['Thai', stamped]]), new Date(2026, 10, 20))).toEqual(new Map());
  });
  it('drops the stamp when the tag is removed, so tagging again starts a new window', () => {
    const settings = new Map([['Thai', on({ priorityStamps: { a: NOW.toISOString() } })]]);
    const out = planPriorityStamps([note('a', 'Thai', [])], settings, NOW);
    expect(out.get('Thai')!.priorityStamps).toBeUndefined();
  });
  it('writes nothing for a deck that is off', () => {
    expect(planPriorityStamps(notes, new Map([['Thai', { priorityFirst: false, priorityTag: 'italki' }]]), NOW).size).toBe(0);
  });
});

describe('parsePriorityNumber', () => {
  it('accepts whole numbers in range and says what to fix otherwise', () => {
    expect(parsePriorityNumber(' 14 ', 1, 365, 'Days')).toEqual({ value: 14 });
    expect(parsePriorityNumber('0', 1, 365, 'Days')).toEqual({ error: 'Days must be from 1 to 365.' });
    expect(parsePriorityNumber('1.5', 1, 365, 'Days')).toHaveProperty('error');
  });
});

describe('the words a skill needs', () => {
  const notes = [note('w1', 'Thai::Skills', ['skill::words']), note('w2', 'Thai::Skills', ['skill::words']), note('c1', 'Thai::Skills', ['skill']), note('x', 'Thai', []), note('p', 'Polski::Skills', ['skill::words'])];

  it('come first with no setting on, a quarter of the room and never the skill cards themselves', () => {
    const boost = boostFor({ notes, settings: new Map(), now: NOW })('Thai')!;
    expect([...boost.noteIds].sort()).toEqual(['w1', 'w2']);
    expect(boost.percent).toBe(SKILL_WORDS_PERCENT);
    expect(SKILL_WORDS_PERCENT).toBe(25);
    expect(boostCap(boost.percent, 20)).toBe(5);
    expect(boostCap(boost.percent, 1)).toBe(1);
  });

  it('stay inside the deck being studied, and give nothing where there are none', () => {
    expect([...boostFor({ notes, settings: new Map(), now: NOW })('Polski')!.noteIds]).toEqual(['p']);
    expect(boostFor({ notes: [notes[3]], settings: new Map(), now: NOW })('Thai')).toBeUndefined();
  });

  it('share one boost with the deck\'s own tagged cards, the larger share winning', () => {
    const tagged = [...notes, note('t', 'Thai', ['italki'])];
    const boost = boostFor({ notes: tagged, settings: new Map([['Thai', on({ priorityPercent: 60 })]]), now: NOW })('Thai')!;
    expect([...boost.noteIds].sort()).toEqual(['t', 'w1', 'w2']);
    expect(boost.percent).toBe(60);
    expect(boostFor({ notes: tagged, settings: new Map([['Thai', on({ priorityPercent: 10 })]]), now: NOW })('Thai')!.percent).toBe(25);
  });
});
