import { describe, expect, it } from 'vitest';
import { foldUndecomposed, foldYo } from '../../src/core/letters';

describe('letters as answer checks compare them', () => {
  it('folds ё into е', () => {
    expect(foldYo('ёлка, всё')).toBe('елка, все');
  });
  it('takes apart the stroke and ligatures that NFD leaves whole', () => {
    expect(foldUndecomposed('brød, ærlig, sœur, złoty')).toBe('brod, aerlig, soeur, zloty');
    expect(foldUndecomposed('brod')).toBe('brod');
  });
});
