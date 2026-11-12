import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_PREFS, parseToolPrefs } from '../../src/tools/prefs';

describe("the Practice tools' saved settings", () => {
  it('reads what was saved', () => {
    expect(parseToolPrefs('{"language":"pl","minuteStep":15,"dateWeekday":false,"dateYear":true,"moneyMode":"price","moneyMax":100}'))
      .toEqual({ language: 'pl', minuteStep: 15, dateWeekday: false, dateYear: true, moneyMode: 'price', moneyMax: 100 });
  });

  it('falls back to the defaults for anything missing, unknown or unreadable', () => {
    expect(parseToolPrefs(null)).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('not json')).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('{"language":"xx","minuteStep":7,"dateWeekday":"yes","moneyMode":"coins","moneyMax":50}')).toEqual(DEFAULT_TOOL_PREFS);
  });
});
