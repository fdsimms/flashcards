import { expect, test } from 'vitest';
import type { ReaderText, TextLine, Word } from '../../src/reader/api';
import { GUESS_HINT, guessIsRight, guessKind, quizFor, tapMode } from '../../src/reader/guess';

test('a guess is right when it is the meaning shown or one of its alternatives', () => {
  expect(guessIsRight('breathing', 'breathing')).toBe(true);
  expect(guessIsRight('  Breathing ', 'breathing')).toBe(true);
  expect(guessIsRight('give change', 'to give change')).toBe(true);
  expect(guessIsRight('return', 'to give back, to return (something)')).toBe(true);
  expect(guessIsRight('the key', 'key')).toBe(true);
  expect(guessIsRight('breathe', 'breathing')).toBe(false);
  expect(guessIsRight('', 'breathing')).toBe(false);
  expect(guessIsRight('breathing', null)).toBe(false);
});

const word = (text: string, gloss: string | null, extra: Partial<Word> = {}): Word =>
  ({ text, status: 'known', gloss, stretch: false, deck: true, grammar: null, ...extra });
const line = (words: Word[]): TextLine => ({ speaker: 'A', english: '', audio: true, words });
const text = (words: Word[]): Pick<ReaderText, 'lines'> => ({ lines: [line(words)] });

const WORDS = [word('ฉัน', 'I'), word('อยาก', 'want to'), word('กิน', 'eat'), word('ไป', 'go'), word('ทอน', 'give change', { status: 'unknown', deck: false })];

test('a known word is recalled and a word outside the deck is inferred from the line', () => {
  expect(guessKind(word('กิน', 'eat'))).toBe('recall');
  expect(guessKind(word('ทอน', 'give change', { status: 'unknown' }))).toBe('infer');
  expect(guessKind(word('รับ', 'receive', { status: 'partial' }))).toBe('infer');
  expect(GUESS_HINT.recall).not.toBe(GUESS_HINT.infer);
});

test('a name, punctuation or a word with nothing to show is never tried', () => {
  expect(guessKind(word('มะลิ', 'Mali', { status: 'name' }))).toBeNull();
  expect(guessKind({ status: null, gloss: null })).toBeNull();
  expect(guessKind(word('กิน', null))).toBeNull();
  expect(guessKind(word('กิน', '  '))).toBeNull();
  // A compound with only its parts' meanings still has something to reveal.
  expect(guessKind(word('เข้าใจ', null, { parts: 'to enter + heart' }))).toBe('recall');
});

test('a quiz has the right meaning and three other glosses from the text, shuffled', () => {
  const q = quizFor(WORDS[2], text(WORDS), () => 0.3);
  expect(q).not.toBeNull();
  expect(q!.choices).toHaveLength(4);
  expect(q!.choices[q!.answer]).toBe('eat');
  expect(new Set(q!.choices.map((c) => c.toLowerCase())).size).toBe(4);
  const again = quizFor(WORDS[2], text(WORDS), () => 0.9)!;
  expect(again.choices[again.answer]).toBe('eat');
});

test('the same gloss on another word, a name and an empty gloss are never wrong choices', () => {
  const words = [...WORDS, word('กิน', 'Eat'), word('มะลิ', 'Mali', { status: 'name' }), word('x', null), word('y', 'GO')];
  const q = quizFor(WORDS[2], text(words), () => 0.5)!;
  expect(q.choices.filter((c) => c.toLowerCase() === 'eat')).toHaveLength(1);
  expect(q.choices).not.toContain('Mali');
});

test('a text with fewer than three other glosses has no quiz', () => {
  expect(quizFor(WORDS[2], text(WORDS.slice(0, 3)))).toBeNull();
  expect(quizFor(word('กิน', null), text(WORDS))).toBeNull();
});

test('guessing first is off, recall, infer or a quiz, as the settings and the word say', () => {
  const t = text(WORDS);
  expect(tapMode(WORDS[2], t, false, true)).toBeNull();
  expect(tapMode(WORDS[2], t, true, false)).toEqual({ kind: 'recall', quiz: null });
  expect(tapMode(WORDS[2], t, true, true)?.quiz).not.toBeNull();
  // The quiz is only for known words: a word outside the deck is inferred.
  expect(tapMode(WORDS[4], t, true, true)).toEqual({ kind: 'infer', quiz: null });
  expect(tapMode(word('มะลิ', 'Mali', { status: 'name' }), t, true, true)).toBeNull();
  // No text, no quiz (a card's sentence): the plain try still applies.
  expect(tapMode(WORDS[2], null, true, true)).toEqual({ kind: 'recall', quiz: null });
});
