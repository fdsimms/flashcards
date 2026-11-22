import { describe, expect, it } from 'vitest';
import { DECK_OPTIONS_LIST, SETTINGS_ENTRIES, SETTINGS_PAGES, searchSettings, settingsPage } from '../../src/core/settingsPages';

describe('settings pages', () => {
  it('gives every entry a unique id and a page that exists', () => {
    const ids = SETTINGS_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SETTINGS_ENTRIES) {
      expect(e.page === 'settings' || e.page === 'deck' || settingsPage(e.page)).toBeTruthy();
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
    expect(searchSettings('autoplay').map((e) => e.id)).toEqual(['keepPlaying']);
    expect(searchSettings('skill').map((e) => e.id)).toEqual(['deckSkills']);
    expect(searchSettings('cards in progress').map((e) => e.id)).toEqual(['deckGate']);
    expect(searchSettings('css').map((e) => e.id)).toEqual(['noteTypes']);
    expect(searchSettings('perfective').map((e) => e.id)).toEqual(['deckAspect']);
    expect(searchSettings('reviews a day').map((e) => e.id)).toEqual(['deckDailyLimits']);
    // Listening settings live on their own screen, not the one that turns Read & Listen on.
    expect(searchSettings('autoplay')[0].route).toBe('/read-listening');
    expect(searchSettings('passphrase')[0].route).toBe('/read-settings');
  });

  it('needs every word, ignores case, and finds nothing for a blank query', () => {
    expect(searchSettings('ANSWER buttons').map((e) => e.id)).toEqual(['answerButtons']);
    expect(searchSettings('answer zebra')).toEqual([]);
    expect(searchSettings('   ')).toEqual([]);
  });

  it("sends a deck's options to the list of decks, since they need a deck", () => {
    for (const e of SETTINGS_ENTRIES.filter((x) => x.page === 'deck')) expect(e.route, e.id).toBe(DECK_OPTIONS_LIST);
  });
});
