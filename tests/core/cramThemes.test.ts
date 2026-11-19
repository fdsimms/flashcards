import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import type { Cram } from '../../src/core/cram';
import {
  combineWeakSpots, FRESH_DAYS, markWords, talkOf, themeCounts, themeDeckWords, themesRequest, themesToAvoid, themeWords, weakSpots, THEME_AVOID_MAX, THEME_WEAK_CHARS, THEME_WEAK_MAX, THEME_WORDS_MAX,
  type ThemeWord,
} from '../../src/core/cramThemes';
import type { Card, Note } from '../../src/core/types';
import type { Marks } from '../../src/tools/marks';
import { omniNote } from '../support/fixtures';

const NOW = new Date(2026, 10, 18, 9);
const DAY = 24 * 60 * 60 * 1000;
const [base] = makeCards(omniNote(), NOW);
// A note's id is its creation time in milliseconds, so these decide which count as lately added.
const added = (daysAgo: number) => String(NOW.getTime() - daysAgo * DAY);
const thai = (id: string, entry: string, meaning: string, tags: string[] = []): Note => ({ ...omniNote({ Entry: entry, Meaning: meaning }), id, tags });
const polish = (id: string): Note => ({ ...omniNote({ Entry: 'książka', Meaning: 'book', Language: 'Polish' }), id });
const studiedCards = (...ids: string[]): Card[] => ids.map((id) => ({ ...base, id: `c${id}`, noteId: id, sched: { ...base.sched, state: 2 } }));
const cram = (over: Partial<Cram> = {}): Cram => ({
  id: 'lesson-2026-11-11', name: 'Lesson', date: '2026-11-11', createdAt: new Date(2026, 10, 9).toISOString(), addNew: true, rounds: [], ...over,
});

describe('themeWords', () => {
  it('puts left-over words first, then missed, then lately added, then the rest, newest first', () => {
    const notes = [
      thai(added(200), 'ก', 'a'), thai(added(3), 'ข', 'b'), thai(added(300), 'ค', 'c'), thai(added(100), 'ง', 'd'), thai(added(5), 'จ', 'e', ['leech']),
    ];
    const [a, , c, d] = notes.map((n) => n.id);
    const finished = cram({ finishedAt: new Date(2026, 10, 12).toISOString(), unused: [c] });
    const rounds = cram({ id: 'later', createdAt: new Date(2026, 10, 15).toISOString(), rounds: [{ finishedAt: new Date(2026, 10, 16).toISOString(), noteIds: [a, d], missed: [d] }] });
    const words = themeWords({ notes, cards: studiedCards(...notes.map((n) => n.id)), language: 'th', crams: [finished, rounds], now: NOW });
    expect(words.map((w) => [w.text, w.kind])).toEqual([['ค', 'carried'], ['จ', 'missed'], ['ง', 'missed'], ['ข', 'fresh'], ['ก', 'deck']]);
  });

  it('takes only studied words in the language that fit a lesson, except left-over ones', () => {
    const notes = [thai('1', 'ก', 'a'), thai('2', 'ข', 'b'), polish('3'), thai('4', 'ค', ''), thai('5', 'ง', 'x'.repeat(201))];
    const unused = cram({ finishedAt: new Date(2026, 10, 12).toISOString(), unused: ['2'] });
    const words = themeWords({ notes, cards: studiedCards('1', '3', '4', '5'), language: 'th', crams: [unused], now: NOW });
    expect(words.map((w) => w.noteId)).toEqual(['2', '1']);
  });

  it('counts a word added within the fresh window and not one just outside it', () => {
    const inside = thai(added(FRESH_DAYS - 1), 'ก', 'a');
    const outside = thai(added(FRESH_DAYS + 1), 'ข', 'b');
    const words = themeWords({ notes: [outside, inside], cards: studiedCards(inside.id, outside.id), language: 'th', crams: [], now: NOW });
    expect(words.map((w) => [w.text, w.kind])).toEqual([['ก', 'fresh'], ['ข', 'deck']]);
  });

  it('sends at most as many words as the server takes', () => {
    const notes = Array.from({ length: THEME_WORDS_MAX + 5 }, (_, i) => thai(added(300 + i), `w${i}`, `m${i}`));
    const words = themeWords({ notes, cards: studiedCards(...notes.map((n) => n.id)), language: 'th', crams: [], now: NOW });
    expect(words).toHaveLength(THEME_WORDS_MAX);
  });
});

describe('weakSpots', () => {
  const at = NOW.getTime();
  const marks: Marks = {
    'time:th': { 'band:thum': { misses: 3, at }, 'minutes:to': { misses: 1, at }, old: { misses: 5, at: at - 60 * DAY } },
    'money:th': { 'ending:2-4': { misses: 1, at } },
    'time:pl': { 'hour:5': { misses: 4, at } },
    'unknown:th': { x: { misses: 9, at } },
  };
  const titleOf = (id: string) => ({ time: 'Telling the time', money: 'Money' } as Record<string, string>)[id];
  it("lists a language's tools with live misses, the most missed first, and skips faded patterns and unknown tools", () => {
    expect(weakSpots(marks, 'th', at, titleOf)).toEqual(['Telling the time: band:thum, minutes:to', 'Money: ending:2-4']);
    expect(weakSpots(marks, 'pl', at, titleOf)).toEqual(['Telling the time: hour:5']);
    expect(weakSpots({}, 'th', at, titleOf)).toEqual([]);
  });
  it('keeps each line and the list within what the server takes', () => {
    const many: Marks = Object.fromEntries(Array.from({ length: THEME_WEAK_MAX + 3 }, (_, i) => [`t${i}:th`, { ['p'.repeat(200)]: { misses: 1, at } }]));
    const lines = weakSpots(many, 'th', at, (id) => `Tool ${id}`);
    expect(lines).toHaveLength(THEME_WEAK_MAX);
    expect(lines.every((l) => l.length <= THEME_WEAK_CHARS)).toBe(true);
  });
});

describe('combineWeakSpots', () => {
  it("puts Practice's lines first, at most half the list, then the kept corrections, within what the server takes", () => {
    const practice = Array.from({ length: 6 }, (_, i) => `P${i}`);
    const kept = Array.from({ length: 6 }, (_, i) => `K${i}`);
    expect(combineWeakSpots(practice, kept)).toEqual(['P0', 'P1', 'P2', 'P3', 'K0', 'K1', 'K2', 'K3']);
    expect(combineWeakSpots(['P0'], kept)).toEqual(['P0', 'K0', 'K1', 'K2', 'K3', 'K4', 'K5']);
    expect(combineWeakSpots([], [])).toEqual([]);
    expect(combineWeakSpots(practice, kept)).toHaveLength(THEME_WEAK_MAX);
  });
});

describe('themesToAvoid', () => {
  it('lists what is on screen, then every cram name and theme newest first, once each, ignoring case', () => {
    const crams = [
      cram({ id: 'a', name: 'At the bank', createdAt: new Date(2026, 10, 1).toISOString() }),
      cram({ id: 'b', name: 'Lesson 4', createdAt: new Date(2026, 10, 5).toISOString(), theme: { title: 'At the BANK', questions: [] } }),
    ];
    expect(themesToAvoid(crams, ['Taxis', '  Taxis '])).toEqual(['Taxis', 'At the BANK', 'Lesson 4']);
  });
  it('stops at what the server takes', () => {
    const crams = Array.from({ length: THEME_AVOID_MAX + 4 }, (_, i) => cram({ id: String(i), name: `Cram ${i}` }));
    expect(themesToAvoid(crams, [])).toHaveLength(THEME_AVOID_MAX);
  });
});

describe('the request, a theme and its story', () => {
  const words: ThemeWord[] = [
    { noteId: 'a', text: 'สั่ง', english: 'order', kind: 'carried' },
    { noteId: 'b', text: 'เผ็ด', english: 'spicy', kind: 'missed' },
    { noteId: 'c', text: 'จาน', english: 'plate', kind: 'deck' },
  ];
  const theme = {
    title: 'Restaurant', why: '', word_ids: ['c', 'zzz', 'a'], new_words: [{ word: 'แพ้', english: 'allergic' }],
    questions: [{ text: 'q', english: 'e' }], story: { text: 'ฉันสั่งอาหาร', english: 'I order food' },
  };
  it('sends every word with its id and why it is there', () => {
    expect(themesRequest('th', words, ['Money: x'], ['Taxis'], true)).toEqual({
      language: 'th',
      words: [{ id: 'a', text: 'สั่ง', english: 'order', kind: 'carried' }, { id: 'b', text: 'เผ็ด', english: 'spicy', kind: 'missed' }, { id: 'c', text: 'จาน', english: 'plate', kind: 'deck' }],
      weak_spots: ['Money: x'], avoid: ['Taxis'], stretch: true,
    });
  });
  it("counts a theme's words by kind and finds the ones still here", () => {
    expect(themeCounts(theme, words)).toEqual({ carried: 1, missed: 0, fresh: 0, deck: 1, new: 1 });
    expect(themeDeckWords(theme, words).map((w) => w.noteId)).toEqual(['c', 'a']);
  });
  it('keeps the questions and the story of the theme for the cram', () => {
    expect(talkOf(theme)).toEqual({ title: 'Restaurant', questions: [{ text: 'q', english: 'e' }], story: { text: 'ฉันสั่งอาหาร', english: 'I order food' } });
    expect(talkOf({ ...theme, story: null }).story).toBeUndefined();
  });
});

describe('markWords', () => {
  it('marks the words found, longest first, without overlap and ignoring case', () => {
    expect(markWords('Hier, la carte et la CARTE du café', ['la carte', 'carte', 'café'])).toEqual([
      { text: 'Hier, ', marked: false }, { text: 'la carte', marked: true }, { text: ' et ', marked: false }, { text: 'la CARTE', marked: true },
      { text: ' du ', marked: false }, { text: 'café', marked: true },
    ]);
  });
  it('works in a language with no spaces and leaves text with no match whole', () => {
    expect(markWords('ฉันสั่งจานสอง', ['สั่ง', 'จาน'])).toEqual([
      { text: 'ฉัน', marked: false }, { text: 'สั่ง', marked: true }, { text: 'จาน', marked: true }, { text: 'สอง', marked: false },
    ]);
    expect(markWords('abc', ['x', ''])).toEqual([{ text: 'abc', marked: false }]);
    expect(markWords('', ['x'])).toEqual([]);
  });
});
