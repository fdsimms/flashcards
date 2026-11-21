import { describe, expect, it } from 'vitest';
import { answerKeyboard, keyboardLanguageFor, keyboardLanguageForText, keyboardRequest } from '../../src/core/keyboardLanguage';

describe('keyboardLanguageFor', () => {
  it('asks for the language when it has its own alphabet', () => {
    expect(keyboardLanguageFor('ru-RU')).toBe('ru');
    expect(keyboardLanguageFor('th-TH')).toBe('th');
    expect(keyboardLanguageFor('el-GR')).toBe('el');
    expect(keyboardLanguageFor('ja-JP')).toBe('ja');
    expect(keyboardLanguageFor('RU_ru')).toBe('ru');
    expect(keyboardLanguageFor('zh')).toBe('zh');
  });

  it('asks for English, so a field for it leaves a Thai or Russian keyboard', () => {
    expect(keyboardLanguageFor('en-US')).toBe('en');
    expect(keyboardLanguageFor('en_GB')).toBe('en');
  });

  it('leaves other Latin-script languages on whatever keyboard is up', () => {
    for (const tag of ['es-MX', 'de-DE', 'fr-FR', 'pl-PL', 'nb-NO']) expect(keyboardLanguageFor(tag)).toBeUndefined();
  });

  it("asks for a Latin-script language's own keyboard, then English, so it leaves a Cyrillic or Thai one", () => {
    expect(keyboardRequest('pl-PL')).toBe('pl,en');
    expect(keyboardRequest('de_DE')).toBe('de,en');
    expect(keyboardRequest('ru-RU')).toBe('ru');
    expect(keyboardRequest('en-US')).toBe('en');
    expect(keyboardRequest(undefined)).toBeUndefined();
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
    expect(keyboardLanguageForText('the word дозор means a patrol')).toBe('en');
  });

  it('asks for English for Latin text, and nothing for digits or an empty answer', () => {
    expect(keyboardLanguageForText('kot')).toBe('en');
    expect(keyboardLanguageForText('Größe')).toBe('en');
    expect(keyboardLanguageForText('1984')).toBeUndefined();
    expect(keyboardLanguageForText('')).toBeUndefined();
  });
});

describe('answerKeyboard', () => {
  it('takes kanji alone as Japanese in a Japanese note, and as Chinese otherwise', () => {
    expect(answerKeyboard('今日', 'ja-JP')).toBe('ja');
    expect(answerKeyboard('今日', undefined)).toBe('zh');
    expect(answerKeyboard('今日', 'zh-CN')).toBe('zh');
    expect(answerKeyboard('kot', 'ja-JP')).toBe('en');
  });
});
