import { describe, expect, it } from 'vitest';
import { LANGUAGE_ORDER } from '../../src/reader/languages';
import { TIME_SAYERS, toolById, toolLanguage, TOOLS } from '../../src/tools/tools';

describe('the Practice tools', () => {
  it('offers Telling the time in every app language, in the app order', () => {
    const time = toolById('time')!;
    expect(time.languages).toEqual(LANGUAGE_ORDER);
    expect(LANGUAGE_ORDER.every((l) => TIME_SAYERS[l])).toBe(true);
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
