import { describe, expect, it } from 'vitest';
import { genderOf, leadingArticle } from '../../src/core/gender';

describe('gender for coloring', () => {
  it('reads m, f and n from the Gender field, however it is cased or spaced', () => {
    expect(genderOf('m')).toBe('m');
    expect(genderOf(' F ')).toBe('f');
    expect(genderOf('n')).toBe('n');
  });

  it('leaves anything else uncolored', () => {
    for (const v of ['', 'mf', 'm/f', 'pl', 'masculine']) expect(genderOf(v)).toBeUndefined();
  });

  it('splits off a leading article and keeps the spacing, so the pieces join back', () => {
    expect(leadingArticle('die Blutung')).toEqual({ article: 'die', rest: ' Blutung' });
    expect(leadingArticle('el desmadre')).toEqual({ article: 'el', rest: ' desmadre' });
    expect(leadingArticle('Das Buch')).toEqual({ article: 'Das', rest: ' Buch' });
    expect(leadingArticle('ο άνθρωπος')).toEqual({ article: 'ο', rest: ' άνθρωπος' });
  });

  it('finds no article in a word that has none, or an article alone', () => {
    expect(leadingArticle('kot')).toBeNull();
    expect(leadingArticle('die')).toBeNull();
    expect(leadingArticle('dieb Haken')).toBeNull();
  });
});
