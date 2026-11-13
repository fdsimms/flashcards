import { describe, expect, it } from 'vitest';
import { LANGUAGE_ORDER } from '../../src/reader/languages';
import { CURRENCIES } from '../../src/tools/money';
import { FIRST_YEAR, LAST_YEAR } from '../../src/tools/date';
import { MAX_AGE, MAX_NUMBER, MIN_AGE, NUMBER_KINDS, randomQuestion } from '../../src/tools/number';
import { CURRENCY_OF, DATE_SAYERS, MONEY_SAYERS, NUMBER_SAYERS, TIME_SAYERS, TOOL_LANGUAGES, toolById, toolLanguage, TOOLS } from '../../src/tools/tools';

describe('the Practice tools', () => {
  it('offers Telling the time in every app language but English, in the app order', () => {
    const time = toolById('time')!;
    expect(time.languages).toEqual(TOOL_LANGUAGES);
    expect(TOOL_LANGUAGES.every((l) => TIME_SAYERS[l])).toBe(true);
  });

  it('offers Saying dates and Counting money in every app language but English too', () => {
    expect(toolById('dates')!.languages).toEqual(TOOL_LANGUAGES);
    expect(toolById('money')!.languages).toEqual(TOOL_LANGUAGES);
    expect(TOOL_LANGUAGES.every((l) => DATE_SAYERS[l] && MONEY_SAYERS[l] && CURRENCIES[CURRENCY_OF[l]!])).toBe(true);
  });

  it('can say every amount in every currency, from the smallest step to the largest', () => {
    for (const l of TOOL_LANGUAGES) {
      const currency = CURRENCIES[CURRENCY_OF[l]!];
      const step = currency.minorStep || currency.minorPerMajor;
      for (const amount of [step, 100, 2100, 100000, 127750 - (127750 % step), 1000000]) {
        expect(MONEY_SAYERS[l]!(amount).everyday.text, `${l} ${amount}`).not.toBe('');
      }
    }
  });

  it('offers Numbers in every app language but English, and says every kind in each', () => {
    expect(toolById('numbers')!.languages).toEqual(TOOL_LANGUAGES);
    for (const l of TOOL_LANGUAGES) {
      for (const n of [0, 1, 11, 21, 100, 101, 1000, 1001, 21_000, 100_000, MAX_NUMBER]) {
        expect(NUMBER_SAYERS[l]!({ kind: 'number', n }).everyday.text, `${l} ${n}`).not.toBe('');
      }
      for (let n = FIRST_YEAR; n <= LAST_YEAR; n++) expect(NUMBER_SAYERS[l]!({ kind: 'year', n }).everyday.text, `${l} ${n}`).not.toBe('');
      for (let n = MIN_AGE; n <= MAX_AGE; n++) expect(NUMBER_SAYERS[l]!({ kind: 'age', n }).everyday.text, `${l} ${n}`).not.toBe('');
      for (const kind of NUMBER_KINDS) {
        for (let i = 0; i < 50; i++) expect(NUMBER_SAYERS[l]!(randomQuestion(kind, l)).everyday.text).not.toBe('');
      }
    }
  });

  it('leaves English out, which the app is already in', () => {
    expect(TOOL_LANGUAGES).not.toContain('en');
    expect(TOOL_LANGUAGES.length).toBe(LANGUAGE_ORDER.length - 1);
    expect(TOOLS.every((t) => !t.languages.includes('en'))).toBe(true);
  });

  it('has a distinct id for each tool', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(toolById('nope')).toBeUndefined();
  });

  it('opens in the language last practiced when the tool has it, else its first', () => {
    const tool = { ...toolById('time')!, languages: ['th' as const, 'pl' as const] };
    expect(toolLanguage(tool, 'pl')).toBe('pl');
    expect(toolLanguage(tool, 'ru')).toBe('th');
    expect(toolLanguage(tool, undefined)).toBe('th');
  });
});
