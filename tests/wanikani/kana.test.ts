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
    expect(toKana('matcha')).toBe('まっちゃ');
    expect(toKana('icchi')).toBe('いっち');
  });

  it('reads n before a consonant as ん, but not before a vowel or y', () => {
    expect(toKana('kanji')).toBe('かんじ');
    expect(toKana('kana')).toBe('かな');
    expect(toKana('kinyoubi')).toBe('きにょうび');
    expect(toKana("kin'youbi")).toBe('きんようび');
  });

  it('reads nn as ん every time, as WaniKani does', () => {
    expect(toKana('konnnichiha')).toBe('こんにちは');
    expect(toKana('konnichiha')).toBe('こんいちは');
    expect(toKana('onnna')).toBe('おんな');
    expect(toKana('hon nn', true)).toBe('ほん ん');
    expect(toKana('sannnen', true)).toBe('さんねん');
  });

  it('reads nn before a vowel or y as ん, not ん plus a な or にゃ syllable', () => {
    expect(toKana('zennin', true)).toBe('ぜんいん');
    expect(toKana('tennin', true)).toBe('てんいん');
    expect(toKana('gennin', true)).toBe('げんいん');
    expect(toKana('honnya')).toBe('ほんや');
    expect(toKana('konnya')).toBe('こんや');
    expect(toKana('kinnyoubi')).toBe('きんようび');
    expect(toKana('kinnen', true)).toBe('きんえん');
    expect(toKana('mannichi')).toBe('まんいち');
  });

  it('still takes n\' and xn for ん', () => {
    expect(toKana("zen'in", true)).toBe('ぜんいん');
    expect(toKana('zexnin', true)).toBe('ぜんいん');
    expect(toKana('hoxnya')).toBe('ほんや');
  });

  it('leaves an unfinished syllable as letters while typing', () => {
    expect(toKana('ky')).toBe('ky');
    expect(toKana('kan')).toBe('かn');
    expect(toKana('konn')).toBe('こん');
    expect(toKana('こnn')).toBe('こん');
    expect(toKana('こんn')).toBe('こんn');
    expect(toKana('こんni')).toBe('こんに');
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
