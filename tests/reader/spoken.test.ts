import { expect, test } from 'vitest';
import type { Word } from '../../src/reader/api';
import { spokenWords } from '../../src/reader/spoken';

const w = (text: string, time?: [number, number]): Word => ({
  text, status: time ? 'known' : null, gloss: null, stretch: false, deck: true, grammar: null, ...(time ? { time } : {}),
});

// ตอนนั้น มีเรือ, with the gap of a clause break between นั้น and มี.
const line = [w('ตอน', [50, 300]), w('นั้น', [300, 520]), w(' '), w('มี', [740, 900]), w('เรือ', [900, 1200])];

test('the word whose time it is is lit', () => {
  expect(spokenWords(line, 100)).toEqual([0]);
  expect(spokenWords(line, 300)).toEqual([1]);
  expect(spokenWords(line, 950)).toEqual([4]);
});

test('nothing is lit before the first word starts', () => {
  expect(spokenWords(line, 0)).toEqual([]);
});

test('a word stays lit through the pause after it, until the next one starts', () => {
  expect(spokenWords(line, 650)).toEqual([1]);
});

test('the last word goes out a moment after it ends', () => {
  expect(spokenWords(line, 1500)).toEqual([4]);
  expect(spokenWords(line, 1700)).toEqual([]);
});

test('two words spoken as one light up together', () => {
  const beach = [w('มา', [0, 200]), w('ชาย', [200, 700]), w('หาด', [200, 700]), w('สวย', [700, 900])];
  expect(spokenWords(beach, 400)).toEqual([1, 2]);
  expect(spokenWords(beach, 1000)).toEqual([3]);
});

test('a word without a time is passed over, and a line with no times lights nothing', () => {
  const partly = [w('ราคา', [0, 300]), { ...w('50'), status: 'known' as const }, w('บาท', [700, 900])];
  expect(spokenWords(partly, 500)).toEqual([0]);
  expect(spokenWords([w('Hola'), w(' '), w('Ana')], 500)).toEqual([]);
});
