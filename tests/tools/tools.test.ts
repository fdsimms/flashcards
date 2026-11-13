import { describe, expect, it } from 'vitest';
import { LANGUAGE_ORDER } from '../../src/reader/languages';
import { CURRENCIES } from '../../src/tools/money';
import { CURRENCY_OF, DATE_SAYERS, MONEY_SAYERS, TIME_SAYERS, toolById, toolLanguage, TOOLS } from '../../src/tools/tools';

// Japanese came to Read & Listen first; its time, dates and money come next.
const PRACTICED = LANGUAGE_ORDER.filter((l) => l !== 'ja');

describe('the Practice tools', () => {
  it('offers Telling the time in every app language, in the app order', () => {
    const time = toolById('time')!;
    expect(time.languages).toEqual(PRACTICED);
    expect(PRACTICED.every((l) => TIME_SAYERS[l])).toBe(true);
  });

  it('offers Saying dates and Counting money in every app language too', () => {
    expect(toolById('dates')!.languages).toEqual(PRACTICED);
    expect(toolById('money')!.languages).toEqual(PRACTICED);
    expect(PRACTICED.every((l) => DATE_SAYERS[l] && MONEY_SAYERS[l] && CURRENCIES[CURRENCY_OF[l]])).toBe(true);
  });

  it('can say every amount in every currency, from the smallest step to the largest', () => {
    for (const l of PRACTICED) {
      const currency = CURRENCIES[CURRENCY_OF[l]];
      const step = currency.minorStep || currency.minorPerMajor;
      for (const amount of [step, 100, 2100, 100000, 127750 - (127750 % step), 1000000]) {
        expect(MONEY_SAYERS[l]!(amount).everyday.text, `${l} ${amount}`).not.toBe('');
      }
    }
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
