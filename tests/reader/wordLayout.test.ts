import { describe, expect, it } from 'vitest';
import type { Word } from '../../src/reader/api';
import { wrapGroups } from '../../src/reader/wordLayout';

const w = (text: string): Word => ({
  text,
  status: /[\p{L}\p{N}]/u.test(text) ? 'known' : null,
  gloss: null,
  stretch: false,
  deck: true,
  grammar: null,
});
const tokens = (...texts: string[]) => texts.map(w);
const texts = (groups: Word[][]) => groups.map((g) => g.map((x) => x.text).join(''));

describe('wrapGroups', () => {
  it('keeps an opening ¿ with the word after it', () => {
    const line = tokens('Buenas', ' ', 'noches', '.', ' ', '¿', 'Tiene', ' ', 'una', ' ', 'reserva', '?');
    expect(texts(wrapGroups(line))).toEqual(['Buenas', ' ', 'noches.', ' ', '¿Tiene', ' ', 'una', ' ', 'reserva?']);
  });

  it('keeps closing punctuation with the word before it, and opening brackets with the word after', () => {
    expect(texts(wrapGroups(tokens('(', 'sí', ')', ',', ' ', '«', 'hola', '»')))).toEqual(['(sí),', ' ', '«hola»']);
  });

  it('never joins two words, so unspaced Thai can still break between them', () => {
    expect(texts(wrapGroups(tokens('ไป', 'ไหน', '?')))).toEqual(['ไป', 'ไหน?']);
  });

  it('reads a straight quote as opening after a space and closing after a word', () => {
    expect(texts(wrapGroups(tokens('dijo', ' ', '"', 'hola', '"', '.')))).toEqual(['dijo', ' ', '"hola".']);
  });

  it('handles stacked and stray punctuation', () => {
    expect(texts(wrapGroups(tokens('¿', '¿', 'qué', '?', '!')))).toEqual(['¿¿qué?!']);
    expect(texts(wrapGroups(tokens('?')))).toEqual(['?']);
    expect(wrapGroups([])).toEqual([]);
  });
});
