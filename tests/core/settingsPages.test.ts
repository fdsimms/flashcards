import { describe, expect, it } from 'vitest';
import { SETTINGS_ENTRIES, SETTINGS_PAGES, searchSettings, settingsPage } from '../../src/core/settingsPages';

describe('settings pages', () => {
  it('gives every entry a unique id and a page that exists', () => {
    const ids = SETTINGS_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SETTINGS_ENTRIES) {
      expect(e.page === 'settings' || settingsPage(e.page)).toBeTruthy();
    }
  });

  it('has something on every page, so a gear never opens an empty one', () => {
    for (const p of SETTINGS_PAGES) {
      expect(SETTINGS_ENTRIES.some((e) => e.page === p.id), p.id).toBe(true);
    }
  });

  it('finds a setting by its label, a keyword or a word prefix', () => {
    expect(searchSettings('reminder').map((e) => e.id)).toEqual(['reminder']);
    expect(searchSettings('khrap').map((e) => e.id)).toEqual(['particle']);
    expect(searchSettings('narr').map((e) => e.id)).toEqual(['narrator']);
    expect(searchSettings('wait answer').map((e) => e.id)).toEqual(['lessonWait']);
  });

  it('needs every word, ignores case, and finds nothing for a blank query', () => {
    expect(searchSettings('ANSWER buttons').map((e) => e.id)).toEqual(['answerButtons']);
    expect(searchSettings('answer zebra')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });
});
