import { describe, expect, it } from 'vitest';
import {
  deckWords,
  endPath,
  FIRST_WORDS,
  LESSON_SCENES,
  lessonScene,
  LESSON_WORDS,
  nextLessonWords,
  parseFromZero,
  pathSteps,
  startPath,
  studiedCount,
  TEXTS_AT,
  textsReady,
  updatePath,
  type DeckWord,
  type FromZero,
} from '../../src/core/fromZero';
import type { Card, Note } from '../../src/core/types';

const note = (id: string, word: string, deck = 'Norsk'): Note => ({ id, deck, model: 'Omnilanguage', fields: { Entry: word, Meaning: `m ${word}` }, tags: [] });
const card = (noteId: string, state: number): Card => ({ noteId, sched: { state } } as unknown as Card);
const words = (n: number, studied = 0): DeckWord[] => Array.from({ length: n }, (_, i) => ({ noteId: String(i), word: `w${i}`, meaning: `m${i}`, studied: i < studied }));
const path = (over: Partial<FromZero> = {}): FromZero => ({ ...startPath([], 'nb', 'Norsk', 1000, 1)[0], ...over });

describe("a deck's words, in the order they came", () => {
  it('orders by when each note was added, with what has been studied', () => {
    const notes = [note('1700000000300', 'og'), note('1700000000100', 'være'), note('1700000000200', 'den'), note('5', 'kat', 'Polski')];
    const got = deckWords(notes, [card('1700000000200', 2), card('1700000000100', 0)], (n) => n.deck === 'Norsk', (n) => n.fields.Entry, (n) => n.fields.Meaning);
    expect(got.map((w) => [w.word, w.studied])).toEqual([['være', false], ['den', true], ['og', false]]);
    expect(studiedCount(got)).toBe(1);
  });
});

describe('lessons and texts', () => {
  it('makes a lesson only from a full set of words not taught yet', () => {
    expect(nextLessonWords({ taught: [] }, words(LESSON_WORDS - 1))).toBeNull();
    expect(nextLessonWords({ taught: [] }, words(20))?.map((w) => w.word)).toEqual(words(LESSON_WORDS).map((w) => w.word));
    const taught = words(LESSON_WORDS).map((w) => w.word.toUpperCase());
    expect(nextLessonWords({ taught }, words(LESSON_WORDS * 2))?.[0].word).toBe(`w${LESSON_WORDS}`);
    // A word with no meaning yet can't be taught.
    expect(nextLessonWords({ taught: [] }, words(LESSON_WORDS).map((w, i) => (i ? w : { ...w, meaning: '' })))).toBeNull();
  });

  it('gives each lesson the next everyday scene, then starts over', () => {
    expect(lessonScene(1)).toBe('Meeting someone for the first time');
    expect(lessonScene(LESSON_SCENES.length + 2)).toBe(LESSON_SCENES[1]);
  });

  it('starts texts once enough words are studied', () => {
    expect(textsReady(words(TEXTS_AT, TEXTS_AT - 1))).toBe(false);
    expect(textsReady(words(TEXTS_AT, TEXTS_AT))).toBe(true);
  });
});

describe('the path on Today', () => {
  it('starts with the sounds and the first words', () => {
    const steps = pathSteps(path(), [], 'Norwegian', 10);
    expect(steps.map((s) => [s.id, s.state])).toEqual([['sounds', 'now'], ['words', 'now'], ['study', 'later'], ['lesson', 'later'], ['texts', 'later']]);
    expect(steps[0].title).toBe('How Norwegian sounds');
    expect(steps[2].title).toBe('Learn them: 10 new a day');
  });

  it('follows the words in, the studying and the lessons', () => {
    const steps = pathSteps(path({ soundsSeen: true, lessons: 1, taught: words(LESSON_WORDS).map((w) => w.word) }), words(FIRST_WORDS, 23), 'Norwegian', 10);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'now', 'now', 'later']);
    expect(steps[2].detail).toBe('23 of 50 studied');
    expect(steps[3].title).toBe('Lesson 2');
    expect(steps[4].detail).toBe(`Start at ${TEXTS_AT} words you've studied. You've studied 23.`);
    expect(steps[4].progress).toBeCloseTo(23 / TEXTS_AT);
    expect(pathSteps(path(), words(20), 'Norwegian', 10)[1].detail).toBe('20 of 50 in your deck');
  });
});

describe('keeping the paths', () => {
  it('starts one a language, changes and ends it', () => {
    const one = startPath([], 'nb', 'Norsk', 1000, 5);
    expect(one).toEqual([{ language: 'nb', deck: 'Norsk', startedAt: 5, soundsSeen: false, taught: [], lessons: 0, common: 1000, hidden: false }]);
    const again = startPath(startPath(one, 'pl', 'Polski', null, 6), 'nb', 'Norsk 2', 0, 7);
    expect(again.map((z) => z.deck)).toEqual(['Polski', 'Norsk 2']);
    expect(updatePath(again, 'pl', (z) => ({ ...z, soundsSeen: true }))[0].soundsSeen).toBe(true);
    expect(endPath(again, 'pl').map((z) => z.language)).toEqual(['nb']);
  });

  it('reads back only whole paths', () => {
    const kept = JSON.stringify([path(), { language: 'pl' }, null]);
    expect(parseFromZero(kept)).toEqual([path()]);
    expect(parseFromZero('not json')).toEqual([]);
    expect(parseFromZero(null)).toEqual([]);
  });
});
