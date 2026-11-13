import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_PREFS, parseToolPrefs } from '../../src/tools/prefs';

describe("the Practice tools' saved settings", () => {
  it('reads what was saved', () => {
    expect(parseToolPrefs('{"language":"pl","minuteStep":15,"dateWeekday":false,"dateYear":true,"dateMode":"type","moneyMode":"price","moneyMax":100,"numberKind":"phone","numberMode":"listen"}'))
      .toEqual({ language: 'pl', minuteStep: 15, dateWeekday: false, dateYear: true, dateMode: 'type', moneyMode: 'price', moneyMax: 100, numberKind: 'phone', numberMode: 'listen' });
  });

  it('falls back to the defaults for anything missing, unknown or unreadable', () => {
    expect(parseToolPrefs(null)).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('not json')).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('{"language":"xx","minuteStep":7,"dateWeekday":"yes","dateMode":"speak","moneyMode":"coins","moneyMax":50,"numberKind":"dates","numberMode":"type"}')).toEqual(DEFAULT_TOOL_PREFS);
  });
});
