import { describe, expect, it } from 'vitest';
import { canonicalText, foldUndecomposed, foldYo, stripMarks } from '../../src/core/letters';

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

describe('canonicalText', () => {
  it('puts a Thai vowel sign before the tone mark, and writes ํ with า as ำ', () => {
    expect(canonicalText('ท่ี')).toBe('ที่');
    expect(canonicalText('นํ้า')).toBe('น้ำ');
    expect(canonicalText('น้ํา')).toBe('น้ำ');
    expect(canonicalText('ไม้้')).toBe('ไม้');
  });

  it('leaves text with no Thai in it as NFC', () => {
    expect(canonicalText('café')).toBe('café');
  });
});
