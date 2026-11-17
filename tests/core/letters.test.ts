import { describe, expect, it } from 'vitest';
import { foldUndecomposed, foldYo, stripMarks } from '../../src/core/letters';

describe('letters as answer checks compare them', () => {
  it('folds ё into е', () => {
    expect(foldYo('ёлка, всё')).toBe('елка, все');
  });
  it('takes apart the stroke and ligatures that NFD leaves whole', () => {
    expect(foldUndecomposed('brød, ærlig, sœur, złoty')).toBe('brod, aerlig, soeur, zloty');
    expect(foldUndecomposed('brod')).toBe('brod');
  });
  it('takes accents and tone marks off, but keeps the voicing marks of kana', () => {
    expect(stripMarks('café'.normalize('NFD')).normalize('NFC')).toBe('cafe');
    expect(stripMarks('ไม้'.normalize('NFD'))).toBe('ไม');
    expect(stripMarks('がぱバ'.normalize('NFD')).normalize('NFC')).toBe('がぱバ');
  });
});
