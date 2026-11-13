import { describe, expect, it } from 'vitest';
import { hasThai, parseThaiTextSize, THAI_TEXT_CHOICES, thaiTextStyle, withThaiLineHeight } from '../../src/core/script';

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
    expect(withThaiLineHeight({ fontSize: 34, fontWeight: '600' }, 'กรกฎาคม')).toEqual({ fontSize: 34, fontWeight: '600', lineHeight: 51 });
  });
  it('leaves other text alone', () => {
    const base = { fontSize: 34 };
    expect(withThaiLineHeight(base, 'July')).toBe(base);
  });
});
