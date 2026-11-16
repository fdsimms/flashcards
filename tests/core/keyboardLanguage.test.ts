import { describe, expect, it } from 'vitest';
import { keyboardLanguageFor } from '../../src/core/keyboardLanguage';

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
