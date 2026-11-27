import { describe, expect, it } from 'vitest';
import { hasCyrillic, hasThai, japaneseFont, parseThaiTextSize, THAI_TEXT_CHOICES, thaiTextStyle, withThaiLineHeight } from '../../src/core/script';

describe('hasThai', () => {
  it('finds Thai script', () => {
    expect(hasThai('วันแรกผมหลงทาง')).toBe(true);
    expect(hasThai('on day 1: วัน')).toBe(true);
  });

  it('is false for its romanization and other scripts', () => {
    expect(hasThai('wan râek phǒm lǒng thaang')).toBe(false);
    expect(hasThai('Привет')).toBe(false);
    expect(hasThai('')).toBe(false);
  });
});

describe('hasCyrillic', () => {
  it('finds Cyrillic script', () => {
    expect(hasCyrillic('Пожалуйста, оставляйте вещи')).toBe(true);
    expect(hasCyrillic('word: вещи')).toBe(true);
  });

  it('is false for Latin and Thai text', () => {
    expect(hasCyrillic('Please leave your things')).toBe(false);
    expect(hasCyrillic('วันแรก')).toBe(false);
    expect(hasCyrillic('')).toBe(false);
  });
});

describe('thai text size', () => {
  it('reads a stored size back, and anything else as Large', () => {
    expect(parseThaiTextSize('largest')).toBe('largest');
    expect(parseThaiTextSize('huge')).toBe('large');
    expect(parseThaiTextSize(null)).toBe('large');
  });

  it('gets taller for each step and leaves room for tone marks', () => {
    const styles = THAI_TEXT_CHOICES.map((c) => thaiTextStyle(c.value));
    for (let i = 1; i < styles.length; i++) expect(styles[i].fontSize).toBeGreaterThan(styles[i - 1].fontSize);
    for (const s of styles) expect(s.lineHeight).toBeGreaterThan(s.fontSize * 1.4);
  });
});

describe('withThaiLineHeight', () => {
  it('gives Thai text a line height of 1.5 times its font size', () => {
    expect(withThaiLineHeight({ fontSize: 34, fontWeight: '600' }, 'กรกฎาคม')).toEqual({ fontSize: 34, fontWeight: '600', lineHeight: 51, paddingBottom: 7 });
  });
  it('leaves room under the line for lower vowels, at every Thai size', () => {
    for (const c of THAI_TEXT_CHOICES) expect(thaiTextStyle(c.value).paddingBottom).toBeGreaterThan(0);
  });
  it('leaves Japanese to a chosen font that draws it, and gives it its face under one that has none', () => {
    expect(japaneseFont('食べる', 'ja-JP', 'yomogi')).toEqual({});
    expect(japaneseFont('食べる', 'ja-JP', 'zenMaru')).toEqual({});
    expect(japaneseFont('食べる', 'ja-JP', 'nunito')).toEqual({ fontFamily: 'Hiragino Sans' });
  });
  it('leaves other text alone', () => {
    const base = { fontSize: 34 };
    expect(withThaiLineHeight(base, 'July')).toBe(base);
  });
});

describe('japaneseFont', () => {
  it("gives text with kana Japanese's face", () => {
    expect(japaneseFont('食べる', undefined, 'system')).toEqual({ fontFamily: 'Hiragino Sans' });
    expect(japaneseFont('ラーメン, ramen', undefined, 'system')).toEqual({ fontFamily: 'Hiragino Sans' });
  });
  it('gives kanji alone the face only in Japanese, since it may be Chinese', () => {
    expect(japaneseFont('四時', 'ja-JP', 'system')).toEqual({ fontFamily: 'Hiragino Sans' });
    expect(japaneseFont('四時', 'ja', 'system')).toEqual({ fontFamily: 'Hiragino Sans' });
    expect(japaneseFont('四时', 'zh-CN', 'system')).toEqual({});
    expect(japaneseFont('四時', undefined, 'system')).toEqual({});
  });
  it('leaves Japanese to a chosen font that draws it, and gives it its face under one that has none', () => {
    expect(japaneseFont('食べる', 'ja-JP', 'yomogi')).toEqual({});
    expect(japaneseFont('食べる', 'ja-JP', 'zenMaru')).toEqual({});
    expect(japaneseFont('食べる', 'ja-JP', 'nunito')).toEqual({ fontFamily: 'Hiragino Sans' });
  });
  it('leaves other text alone', () => {
    expect(japaneseFont('theater company', 'ja-JP', 'system')).toEqual({});
    expect(japaneseFont('หนังสือ', undefined, 'system')).toEqual({});
  });
});
