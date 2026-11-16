import { describe, expect, it } from 'vitest';
import { keyboardLanguageFor, keyboardLanguageForText } from '../../src/core/keyboardLanguage';

describe('keyboardLanguageFor', () => {
  it('asks for the language when it has its own alphabet', () => {
    expect(keyboardLanguageFor('ru-RU')).toBe('ru');
    expect(keyboardLanguageFor('th-TH')).toBe('th');
    expect(keyboardLanguageFor('el-GR')).toBe('el');
    expect(keyboardLanguageFor('ja-JP')).toBe('ja');
    expect(keyboardLanguageFor('RU_ru')).toBe('ru');
    expect(keyboardLanguageFor('zh')).toBe('zh');
  });

  it('leaves Latin-script languages on whatever keyboard is up', () => {
    for (const tag of ['en-US', 'es-MX', 'de-DE', 'fr-FR', 'pl-PL', 'nb-NO']) expect(keyboardLanguageFor(tag)).toBeUndefined();
  });

  it('asks for nothing without a language', () => {
    expect(keyboardLanguageFor(undefined)).toBeUndefined();
    expect(keyboardLanguageFor(null)).toBeUndefined();
    expect(keyboardLanguageFor('')).toBeUndefined();
  });
});

describe('keyboardLanguageForText', () => {
  it('reads the script of the answer', () => {
    expect(keyboardLanguageForText('дозор')).toBe('ru');
    expect(keyboardLanguageForText('ευχαριστώ')).toBe('el');
    expect(keyboardLanguageForText('สวัสดี')).toBe('th');
    expect(keyboardLanguageForText('안녕하세요')).toBe('ko');
    expect(keyboardLanguageForText('שלום')).toBe('he');
  });

  it('takes kanji with kana as Japanese and kanji alone as Chinese', () => {
    expect(keyboardLanguageForText('食べる')).toBe('ja');
    expect(keyboardLanguageForText('你好')).toBe('zh');
  });

  it('uses the majority script when an answer mixes them', () => {
    expect(keyboardLanguageForText('дозорный (a)')).toBe('ru');
    expect(keyboardLanguageForText('the word дозор means a patrol')).toBeUndefined();
  });

  it('asks for nothing for Latin text, digits or an empty answer', () => {
    expect(keyboardLanguageForText('kot')).toBeUndefined();
    expect(keyboardLanguageForText('Größe')).toBeUndefined();
    expect(keyboardLanguageForText('1984')).toBeUndefined();
    expect(keyboardLanguageForText('')).toBeUndefined();
  });
});
