import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_PREFS, parseToolPrefs } from '../../src/tools/prefs';

describe("the Practice tools' saved settings", () => {
  it('reads what was saved', () => {
    expect(parseToolPrefs('{"language":"pl","minuteStep":15}')).toEqual({ language: 'pl', minuteStep: 15 });
  });

  it('falls back to the defaults for anything missing, unknown or unreadable', () => {
    expect(parseToolPrefs(null)).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('not json')).toEqual(DEFAULT_TOOL_PREFS);
    expect(parseToolPrefs('{"language":"xx","minuteStep":7}')).toEqual(DEFAULT_TOOL_PREFS);
  });
});
