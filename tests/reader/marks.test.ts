import { expect, test } from 'vitest';
import type { ReaderText, TextGrammar, Word } from '../../src/reader/api';
import { grammarMark, marksIn, withMark } from '../../src/reader/marks';

const word = (text: string, extra: Partial<Word> = {}): Word => ({ text, status: 'known', gloss: null, stretch: false, deck: true, grammar: null, ...extra });
const point = (id: string, role: TextGrammar['role']): TextGrammar => ({ id, name: id, note: '', role });

const textOf = (words: Word[], grammar: TextGrammar[] = []): ReaderText => ({
  id: 1, topicId: 1, title: 't', coverage: 0.95, stretch: [], roles: {}, form: 'story', language: 'th', grammar,
  lines: [{ speaker: 'N', english: '', audio: false, words }],
});

test('a text with nothing marked lists nothing', () => {
  expect(marksIn(textOf([word('เขา'), word(' ', { status: null })]), () => false)).toEqual([]);
});

test('each mark the text uses is listed once, in the key order, with its first word', () => {
  const text = textOf(
    [
      word('ต้น', { status: 'unknown' }), word('รับ', { status: 'partial' }), word('มาลี', { status: 'name' }),
      word('มะม่วง', { stretch: true }), word('แล้ว', { grammar: 'g1' }), word('จะ', { grammar: 'g2' }), word('ขอบคุณ'),
    ],
    [point('g1', 'practice'), point('g2', 'avoid')],
  );
  const found = marksIn(text, (w) => w === 'ขอบคุณ');
  expect(found.map((e) => e.mark)).toEqual(['highlight', 'name', 'stretch', 'practice', 'avoid', 'marked']);
  expect(found[0].word.text).toBe('ต้น');
  expect(found[3].grammar?.id).toBe('g1');
});

test('Know it and Not set share one mark', () => {
  expect(grammarMark('review')).toBe('known');
  expect(grammarMark('unset')).toBe('known');
  expect(grammarMark('practice')).toBe('practice');
  expect(grammarMark('avoid')).toBe('avoid');
  const text = textOf([word('แล้ว', { grammar: 'g1' })], [point('g1', 'unset')]);
  expect(marksIn(text, () => false).map((e) => e.mark)).toEqual(['known']);
});

test('a word pointing at a grammar point the text does not carry has no grammar mark', () => {
  expect(marksIn(textOf([word('แล้ว', { grammar: 'gone' })]), () => false)).toEqual([]);
});

test('spaces and punctuation are never marked, even if flagged', () => {
  expect(marksIn(textOf([word(' ', { status: null })]), () => true)).toEqual([]);
});

test('switching a mark off adds it once; on removes it', () => {
  expect(withMark([], 'stretch', false)).toEqual(['stretch']);
  expect(withMark(['stretch'], 'stretch', false)).toEqual(['stretch']);
  expect(withMark(['stretch', 'marked'], 'stretch', true)).toEqual(['marked']);
});
