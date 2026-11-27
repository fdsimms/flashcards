import { describe, expect, it } from 'vitest';
import {
  DOWNLOADABLE_FONTS, FONT_DOWNLOADS, availableFont, availableFonts, downloadBytes, isAvailable, languageFontChoices, sizeText,
} from '../../src/core/fontDownloads';
import { APP_FONT_OPTIONS, fontFileNames, type AppFont } from '../../src/core/fonts';

describe('the font downloads', () => {
  it('lists the fonts that are not bundled, each with every one of its files', () => {
    expect(DOWNLOADABLE_FONTS).toEqual(['yomogi', 'zenKurenaido', 'zenMaru']);
    for (const id of DOWNLOADABLE_FONTS) {
      expect((FONT_DOWNLOADS[id] ?? []).map((f) => f.name).sort(), id).toEqual(fontFileNames(id).sort());
    }
  });
  it('has no download for a bundled font', () => {
    for (const o of APP_FONT_OPTIONS.filter((x) => !x.download)) expect(FONT_DOWNLOADS[o.id]).toBeUndefined();
  });
  it('points at a version-pinned file on jsDelivr over https, in the folder its package uses', () => {
    expect(FONT_DOWNLOADS.yomogi?.[0].url).toBe('https://cdn.jsdelivr.net/npm/@expo-google-fonts/yomogi@0.4.2/400Regular/Yomogi_400Regular.ttf');
    expect(FONT_DOWNLOADS.zenMaru?.[0].url).toBe('https://cdn.jsdelivr.net/npm/@expo-google-fonts/zen-maru-gothic@0.4.2/400Regular/ZenMaruGothic_400Regular.ttf');
    for (const id of DOWNLOADABLE_FONTS) for (const f of FONT_DOWNLOADS[id] ?? []) {
      expect(f.url).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@expo-google-fonts\/[a-z0-9-]+@\d+\.\d+\.\d+\/[0-9A-Za-z]+\/[A-Za-z0-9]+_[0-9A-Za-z]+\.ttf$/);
      expect(f.bytes).toBeGreaterThan(1_000_000);
    }
  });
});

describe('sizes', () => {
  it('adds a font’s files and writes megabytes to one place', () => {
    expect(downloadBytes('yomogi')).toBe(4044704);
    expect(downloadBytes('nunito')).toBe(0);
    expect(sizeText(4044704)).toBe('4.0 MB');
    expect(sizeText(3832732)).toBe('3.8 MB');
  });
});

describe('what can be used', () => {
  const none = new Set<AppFont>();
  const some = new Set<AppFont>(['yomogi']);
  it('uses a bundled font always, and a downloaded one once it is on the phone', () => {
    expect(isAvailable('nunito', none)).toBe(true);
    expect(isAvailable('yomogi', none)).toBe(false);
    expect(isAvailable('yomogi', some)).toBe(true);
  });
  it('falls back to the system font for one that is not', () => {
    expect(availableFont('yomogi', none)).toBe('system');
    expect(availableFont('yomogi', some)).toBe('yomogi');
    expect(availableFont('lora', none)).toBe('lora');
  });
  it('keeps the usable ones of a list, in order', () => {
    expect(availableFonts(['zenMaru', 'lora', 'yomogi'], some)).toEqual(['lora', 'yomogi']);
  });
});

describe('languageFontChoices', () => {
  it('offers the fonts that draw the language and are on the phone, system first', () => {
    const none = new Set<AppFont>();
    expect(languageFontChoices('de', none)[0]).toBe('system');
    expect(languageFontChoices('ru-RU', none)).toContain('nunito');
    expect(languageFontChoices('ru', none)).not.toContain('mali');
    expect(languageFontChoices('th', none)).toEqual(expect.arrayContaining(['system', 'mali', 'prompt']));
  });
  it('lists a downloadable font only once it is installed', () => {
    expect(languageFontChoices('ja', new Set())).toEqual(['system']);
    expect(languageFontChoices('ja', new Set<AppFont>(['yomogi']))).toEqual(['system', 'yomogi']);
  });
});
