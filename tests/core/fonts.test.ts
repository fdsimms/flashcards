import { describe, expect, it } from 'vitest';
import {
  APP_FONT_OPTIONS, CYCLE_FONTS, DEFAULT_FONT_SETTINGS, cardFontFor, fontFileName, fontFileNames, launchFont, normalizeFontWeight,
  parseFontSettings, resolveFontFace, togglePoolFont, type AppFont,
} from '../../src/core/fonts';
import { deckCardFonts } from '../../src/core/deckTree';

describe('normalizeFontWeight', () => {
  it('snaps any weight onto the three bundled faces', () => {
    expect(normalizeFontWeight(undefined)).toBe(400);
    expect(normalizeFontWeight('normal')).toBe(400);
    expect(normalizeFontWeight('500')).toBe(400);
    expect(normalizeFontWeight('600')).toBe(600);
    expect(normalizeFontWeight('bold')).toBe(700);
    expect(normalizeFontWeight('800')).toBe(700);
    expect(normalizeFontWeight('junk')).toBe(400);
  });
});

describe('resolveFontFace', () => {
  it('names the PostScript face, or nothing for the system font', () => {
    expect(resolveFontFace('nunito', '600')).toBe('Nunito-SemiBold');
    expect(resolveFontFace('sourceSerif', undefined)).toBe('SourceSerif4-Regular');
    expect(resolveFontFace('system', '700')).toBeUndefined();
  });
  it('has a file for every face', () => {
    expect(fontFileName('lora', 700)).toBe('Lora_700Bold.ttf');
    expect(fontFileNames('inter')).toEqual(['Inter_400Regular.ttf', 'Inter_600SemiBold.ttf', 'Inter_700Bold.ttf']);
    expect(fontFileNames('system')).toEqual([]);
  });
});

describe('parseFontSettings', () => {
  it('falls back to the default for nothing, junk or an unshipped font', () => {
    expect(parseFontSettings(undefined)).toEqual(DEFAULT_FONT_SETTINGS);
    expect(parseFontSettings('{nope')).toEqual(DEFAULT_FONT_SETTINGS);
    expect(parseFontSettings('{"font":"outfit"}').font).toBe('system');
  });
  it('keeps a valid choice, drops unknown pool entries, and never leaves the pool empty', () => {
    const s = parseFontSettings(JSON.stringify({ font: 'lora', random: true, pool: ['inter', 'outfit', 'inter'], onCards: false }));
    expect(s).toEqual({ font: 'lora', random: true, pool: ['inter'], onCards: false });
    expect(parseFontSettings('{"font":"lora","pool":[]}').pool).toEqual(['lora']);
  });
});

describe('launchFont', () => {
  const s = { ...DEFAULT_FONT_SETTINGS, font: 'lora' as AppFont, pool: ['nunito', 'inter', 'manrope'] as AppFont[] };
  it('uses the chosen font unless random is on', () => {
    expect(launchFont(s, () => 0.9)).toBe('lora');
  });
  it('picks from the pool when random is on, including at the edges of the draw', () => {
    expect(launchFont({ ...s, random: true }, () => 0)).toBe('nunito');
    expect(launchFont({ ...s, random: true }, () => 0.5)).toBe('inter');
    expect(launchFont({ ...s, random: true }, () => 0.999999)).toBe('manrope');
    expect(launchFont({ ...s, random: true }, () => 1)).toBe('manrope');
  });
});

describe('togglePoolFont', () => {
  it('adds in list order, removes, and keeps the last one', () => {
    expect(togglePoolFont(['lora'], 'nunito')).toEqual(['nunito', 'lora']);
    expect(togglePoolFont(['nunito', 'lora'], 'nunito')).toEqual(['lora']);
    expect(togglePoolFont(['lora'], 'lora')).toEqual(['lora']);
  });
});

describe('cardFontFor', () => {
  it('gives no font for a deck that does not cycle', () => {
    expect(cardFontFor([], 'c1', 1)).toBeUndefined();
  });
  it('is the same for one card in one session, and always from the pool', () => {
    const pool: AppFont[] = ['nunito', 'lora', 'inter'];
    expect(cardFontFor(pool, 'c1', 7)).toBe(cardFontFor(pool, 'c1', 7));
    for (let i = 0; i < 50; i++) expect(pool).toContain(cardFontFor(pool, `card${i}`, 3));
  });
  it('spreads cards over the pool and reshuffles with the session', () => {
    const pool = CYCLE_FONTS;
    const ids = Array.from({ length: 200 }, (_, i) => `card${i}`);
    const a = ids.map((id) => cardFontFor(pool, id, 1));
    const b = ids.map((id) => cardFontFor(pool, id, 2));
    expect(new Set(a).size).toBe(pool.length);
    expect(a.filter((f, i) => f !== b[i]).length).toBeGreaterThan(100);
  });
});

describe('the font list', () => {
  it('has the system font first and every other one bundled', () => {
    expect(APP_FONT_OPTIONS[0].id).toBe('system');
    expect(CYCLE_FONTS).not.toContain('system');
    for (const id of CYCLE_FONTS) expect(fontFileNames(id)).toHaveLength(3);
  });
});

describe('deckCardFonts', () => {
  const all = (entries: Record<string, AppFont[]>) => new Map(Object.entries(entries).map(([d, cardFonts]) => [d, { cardFonts }]));
  it('is empty when nothing is set, so cards use the app font', () => {
    expect(deckCardFonts('Русский', new Map())).toEqual([]);
  });
  it('is inherited from the nearest deck above, and an empty list on a subdeck turns it off', () => {
    const s = all({ 'Русский': ['lora', 'inter'], 'Русский::Глаголы': [] });
    expect(deckCardFonts('Русский::Слова', s)).toEqual(['lora', 'inter']);
    expect(deckCardFonts('Русский::Глаголы', s)).toEqual([]);
  });
  it('drops a font that is no longer shipped', () => {
    expect(deckCardFonts('A', all({ A: ['outfit' as AppFont, 'lora'] }))).toEqual(['lora']);
  });
});
