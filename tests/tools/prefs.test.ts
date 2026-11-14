import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_PREFS, parseToolPrefs } from '../../src/tools/prefs';

describe("the Practice tools' saved settings", () => {
  it('reads what was saved', () => {
    expect(parseToolPrefs('{"language":"pl","minuteStep":15,"timeMode":"listen","moneyAnswer":"listen","dateWeekday":false,"dateYear":true,"dateMode":"type","moneyMode":"price","moneyMax":100,"numberKind":"phone","numberMode":"listen","countMode":"pick","countMax":100,"scriptMode":"read","mixupMode":"ear"}'))
      .toEqual({ language: 'pl', minuteStep: 15, timeMode: 'listen', moneyAnswer: 'listen', dateWeekday: false, dateYear: true, dateMode: 'type', moneyMode: 'price', moneyMax: 100, numberKind: 'phone', numberMode: 'listen', countMode: 'pick', countMax: 100, scriptMode: 'read', mixupMode: 'ear' });
  });

  it('falls back to the defaults for anything missing, unknown or unreadable', () => {
    expect(parseToolPrefs(null)).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('not json')).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('{"language":"xx","minuteStep":7,"timeMode":"hear","moneyAnswer":true,"dateWeekday":"yes","dateMode":"speak","moneyMode":"coins","moneyMax":50,"numberKind":"dates","numberMode":"type","countMode":"type","countMax":1000,"scriptMode":"write","mixupMode":"sound"}')).toEqual(DEFAULT_TOOL_PREFS);
  });
});
