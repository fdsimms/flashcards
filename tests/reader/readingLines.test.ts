import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import type { Note, RenderedSide } from '../../src/core/types';
import type { ReadingLine } from '../../src/reader/api';
import { lineFor, lineWord, readingLineRequests, withReadingLine } from '../../src/reader/readingLines';
import { NOW, omniNote } from '../support/fixtures';

const THAI = '👅 Languages::🐘 ภาษาไทย';
const decks = { th: THAI, es: '👅 Languages::🌮 Español' };
const note = (id: string, entry: string, deck = THAI): Note => ({ ...omniNote({ Entry: entry }), id, deck });
const line = (n: number): ReadingLine => ({ text_id: n, title: `Text ${n}`, line: `line ${n}`, english: `english ${n}` });

describe('readingLineRequests', () => {
  it('asks for each card\'s word once, by language, and leaves out what was asked', () => {
    const notes = [note('a', '<b>กิน</b>'), note('b', 'ไป'), note('c', 'comer', decks.es), note('d', 'x', 'Trivia')];
    const cards = notes.flatMap((n) => makeCards({ ...n, fields: { ...n.fields, GenerateReverse: 'y' } }, NOW));
    const map = new Map(notes.map((n) => [n.id, n]));
    expect(readingLineRequests(cards, map, decks)).toEqual([{ language: 'th', words: ['กิน', 'ไป'] }, { language: 'es', words: ['comer'] }]);
    expect(readingLineRequests(cards, map, decks, new Set(['th:กิน', 'es:comer']))).toEqual([{ language: 'th', words: ['ไป'] }]);
  });

  it('has no word for another note type', () => {
    expect(lineWord({ id: 'b', deck: 'Trivia', model: 'Basic', fields: { Front: 'a', Back: 'b' }, tags: [] })).toBe('');
  });
});

describe('lineFor', () => {
  it('takes turns by how many times the card was answered', () => {
    const lines = [line(1), line(2), line(3)];
    expect([0, 1, 2, 3, 4].map((reps) => lineFor(lines, reps)?.text_id)).toEqual([1, 2, 3, 1, 2]);
  });
  it("never repeats the note's own sentence, and shows nothing with no line", () => {
    expect(lineFor([line(1), line(2)], 0, ['line 1'])?.text_id).toBe(2);
    expect(lineFor([line(1)], 3, ['line 1'])).toBeUndefined();
    expect(lineFor(undefined, 0)).toBeUndefined();
    expect(lineFor([], 0)).toBeUndefined();
  });
});

describe('withReadingLine', () => {
  const blocks: RenderedSide['blocks'] = [
    { text: 'to eat', emphasis: true }, { text: 'ฉันกินข้าว', role: 'example' }, { text: 'I eat rice.', role: 'exampleTranslation', tapLabel: 'Show translation' },
    { text: 'from Pali', label: 'Etymology' },
  ];
  const read = { text_id: 7, title: 'At the market', line: 'เขากินข้าวที่ตลาด', english: 'He eats at the market.', word: 'กิน' };
  it("puts the line in its own example box right after the note's example, the word marked and its English behind a tap", () => {
    const out = withReadingLine(blocks, read, 'กิน');
    expect(out.map((b) => b.text)).toEqual(['to eat', 'ฉันกินข้าว', 'I eat rice.', 'เขากินข้าวที่ตลาด', 'He eats at the market.', 'from Pali']);
    expect(out[3]).toMatchObject({ role: 'example', source: 'your reading, At the market' });
    expect(out[3].segments?.filter((s) => s.marked).map((s) => s.text)).toEqual(['กิน']);
    expect(out[4]).toEqual({ text: 'He eats at the market.', role: 'exampleTranslation', tapLabel: 'Show translation' });
  });
  it("marks the word as the line has it, and the card's word from an older server", () => {
    const formed = { ...read, line: 'Wir haben Hunde.', english: 'We have dogs.', word: 'Hunde' };
    expect(withReadingLine([], formed, 'Hund')[0].segments?.filter((s) => s.marked).map((s) => s.text)).toEqual(['Hunde']);
    const older = { text_id: 7, title: 'A', line: 'Der Hund schläft.', english: '' };
    const out = withReadingLine([], older, 'Hund');
    expect(out).toHaveLength(1);
    expect(out[0].segments?.filter((s) => s.marked).map((s) => s.text)).toEqual(['Hund']);
  });
  it('goes last on a card with no example, and changes nothing with no line', () => {
    expect(withReadingLine([blocks[0]], line(7), 'x').map((b) => b.text)).toEqual(['to eat', 'line 7', ...(line(7).english ? [line(7).english] : [])]);
    expect(withReadingLine(blocks, undefined, 'x')).toEqual(blocks);
  });
});
