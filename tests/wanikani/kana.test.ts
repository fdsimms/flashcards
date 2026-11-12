import { describe, expect, it } from 'vitest';
import { hasJapanese, isKana, toHiragana, toKana } from '../../src/wanikani/kana';

describe('romaji to kana', () => {
  it('converts syllables, including y-combinations and the shi/chi/tsu spellings', () => {
    expect(toKana('otona')).toBe('おとな');
    expect(toKana('kyou')).toBe('きょう');
    expect(toKana('shashin')).toBe('しゃしn');
    expect(toKana('shashin', true)).toBe('しゃしん');
    expect(toKana('chikatetsu')).toBe('ちかてつ');
    expect(toKana('jouzu')).toBe('じょうず');
  });

  it('doubles a consonant into a small tsu', () => {
    expect(toKana('kitte')).toBe('きって');
    expect(toKana('zasshi')).toBe('ざっし');
  });

  it('reads n before a consonant as ん, but not before a vowel or y', () => {
    expect(toKana('kanji')).toBe('かんじ');
    expect(toKana('kana')).toBe('かな');
    expect(toKana('kinyoubi')).toBe('きにょうび');
    expect(toKana("kin'youbi")).toBe('きんようび');
  });

  it('uses one n of a pair before a vowel, and both otherwise', () => {
    expect(toKana('konnichiha')).toBe('こんにちは');
    expect(toKana('onna')).toBe('おんな');
    expect(toKana('hon nn', true)).toBe('ほん ん');
    expect(toKana('sannen', true)).toBe('さんねん');
  });

  it('leaves an unfinished syllable as letters while typing', () => {
    expect(toKana('ky')).toBe('ky');
    expect(toKana('kan')).toBe('かn');
    expect(toKana('konn')).toBe('こnn');
    expect(toKana('こnn')).toBe('こnn');
    expect(toKana('こnni')).toBe('こんに');
  });

  it('leaves kana typed on a Japanese keyboard alone, and keeps converting after it', () => {
    expect(toKana('おとな')).toBe('おとな');
    expect(toKana('おとna')).toBe('おとな');
  });

  it('writes small kana and the long vowel mark', () => {
    expect(toKana('xa')).toBe('ぁ');
    expect(toKana('ltu')).toBe('っ');
    expect(toKana('ra-men')).toBe('らーめn');
  });
});

describe('kana checks', () => {
  it('reads katakana as hiragana', () => {
    expect(toHiragana('ジュース')).toBe('じゅーす');
    expect(toHiragana('おとな')).toBe('おとな');
  });

  it('knows kana from anything else', () => {
    expect(isKana('おとな')).toBe(true);
    expect(isKana('ジュース')).toBe(true);
    expect(isKana('おとn')).toBe(false);
    expect(isKana('')).toBe(false);
    expect(hasJapanese('adult')).toBe(false);
    expect(hasJapanese('大人')).toBe(true);
  });
});
