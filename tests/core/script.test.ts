import { describe, expect, it } from 'vitest';
import { hasThai } from '../../src/core/script';

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
