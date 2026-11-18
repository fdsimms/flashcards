import { describe, expect, it } from 'vitest';
import type { WordKanji } from '../../src/reader/api';
import { kanjiSpoken, kunReading, meaningsLine, readingsLine } from '../../src/reader/kanji';

const cold: WordKanji = { char: '寒', meanings: ['cold'], on: ['カン'], kun: ['さむ.い'], strokes: 12 };

describe('kanji rows', () => {
  it('sets the okurigana off with a middle dot', () => {
    expect(kunReading('さむ.い')).toBe('さむ・い');
    expect(kunReading('はだ')).toBe('はだ');
  });

  it('writes the readings on one line', () => {
    expect(readingsLine(cold)).toBe('kun さむ・い · on カン');
    expect(readingsLine({ ...cold, kun: ['つづ.まる', 'つづ.める'] })).toBe('kun つづ・まる、つづ・める · on カン');
  });

  it('leaves out a kind of reading there is none of', () => {
    expect(readingsLine({ ...cold, kun: [] })).toBe('on カン');
    expect(readingsLine({ ...cold, on: [] })).toBe('kun さむ・い');
    expect(readingsLine({ ...cold, on: [], kun: [] })).toBe('');
  });

  it('joins the meanings', () => {
    expect(meaningsLine({ ...cold, meanings: ['skin', 'body'] })).toBe('skin, body');
  });

  it('speaks a row with its character, meanings and readings', () => {
    expect(kanjiSpoken(cold)).toBe('寒. cold. kun さむ・い · on カン');
    expect(kanjiSpoken({ ...cold, meanings: [], kun: [], on: [] })).toBe('寒');
  });
});
