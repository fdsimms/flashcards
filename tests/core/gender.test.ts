import { describe, expect, it } from 'vitest';
import { articleIsSpoken, bareNoun, bareVerb, elidesBefore, genderArticle, genderOf, leadingArticle, pluralWord, spokenEntry, verbMarker, withArticle } from '../../src/core/gender';

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

  it('splits off the plural article a plural-only noun keeps, so it is colored and gets no second one', () => {
    expect(leadingArticle('los modales')).toEqual({ article: 'los', rest: ' modales' });
    expect(leadingArticle('οι ειδήσεις')).toEqual({ article: 'οι', rest: ' ειδήσεις' });
    expect(leadingArticle('les tripes')).toEqual({ article: 'les', rest: ' tripes' });
    expect(genderArticle('es', 'm', 'los modales')).toBeUndefined();
    expect(genderArticle('el', 'n', 'τα δεδομένα')).toBeUndefined();
  });

  it('finds no article in a word that has none, or an article alone', () => {
    expect(leadingArticle('kot')).toBeNull();
    expect(leadingArticle('die')).toBeNull();
    expect(leadingArticle('dieb Haken')).toBeNull();
  });

  it("splits off French l' with no space, so the pieces still join back", () => {
    expect(leadingArticle("l'amertume")).toEqual({ article: "l'", rest: 'amertume' });
    expect(leadingArticle('l’heure')).toEqual({ article: 'l’', rest: 'heure' });
  });
});

describe('the article shown before a bare Entry', () => {
  it('is the gender\'s article in each language that has one', () => {
    expect(genderArticle('de', 'f', 'Einstellung')).toBe('die');
    expect(genderArticle('de', 'n', 'Buch')).toBe('das');
    expect(genderArticle('el', 'n', 'μπουκάλι')).toBe('το');
    expect(genderArticle('fr', 'm', 'morceau')).toBe('le');
    expect(genderArticle('nb', 'f', 'huske')).toBe('ei');
  });

  it("is l' for a French noun that starts with a vowel, whichever its gender", () => {
    expect(genderArticle('fr', 'f', 'amertume')).toBe("l'");
    expect(genderArticle('fr', 'm', 'ami')).toBe("l'");
    expect(withArticle("l'", 'amertume')).toBe("l'amertume");
    expect(withArticle('le', 'morceau')).toBe('le morceau');
  });

  it("leaves an h to the Entry, which keeps its article (l'homme, le héros), and an Entry that has one", () => {
    expect(genderArticle('fr', 'm', "l'homme")).toBeUndefined();
    expect(genderArticle('fr', 'm', 'le héros')).toBeUndefined();
    expect(genderArticle('es', 'f', 'el agua')).toBeUndefined();
    expect(genderArticle('de', 'm', 'der Tisch')).toBeUndefined();
  });

  it('is nothing without a gender or for a language with no table', () => {
    expect(genderArticle('de', undefined, 'Tisch')).toBeUndefined();
    expect(genderArticle('it', 'm', 'ragazzo')).toBeUndefined();
    expect(elidesBefore('de', 'Apfel')).toBe(false);
  });

  it('is said with the word wherever the card shows one before it', () => {
    for (const l of ['es', 'nb', 'de', 'fr', 'el', 'ru', 'pl']) expect(articleIsSpoken(l)).toBe(true);
    expect(articleIsSpoken('th')).toBe(false);
  });
});

describe('a noun without the article its Gender gives', () => {
  it("drops the article the Gender gives, l' and der included", () => {
    expect(bareNoun('de', 'm', 'der Tisch')).toBe('Tisch');
    expect(bareNoun('fr', 'f', "l'amertume")).toBe('amertume');
    expect(bareNoun('fr', 'm', 'le morceau')).toBe('morceau');
    expect(bareNoun('el', 'f', 'η γειτονιά')).toBe('γειτονιά');
    expect(bareNoun('nb', 'f', 'ei bok')).toBe('bok');
  });

  it('keeps an article that is the exception, or a word with none or no gender', () => {
    expect(bareNoun('es', 'f', 'el agua')).toBe('el agua');
    expect(bareNoun('nb', 'f', 'en bok')).toBe('en bok');
    expect(bareNoun('fr', 'm', "l'homme")).toBe("l'homme");
    expect(bareNoun('de', 'm', 'Tisch')).toBe('Tisch');
    expect(bareNoun('de', undefined, 'der Tisch')).toBe('der Tisch');
    expect(bareNoun('ru', 'm', 'этот стол')).toBe('этот стол');
  });
});

describe("a Norwegian verb's å", () => {
  it('goes before a bare verb, and nowhere else', () => {
    expect(verbMarker('nb', 'verb', 'huske')).toBe('å');
    expect(verbMarker('nb', ' Verb ', 'huske')).toBe('å');
    expect(verbMarker('nb', 'noun', 'huske')).toBeUndefined();
    expect(verbMarker('nb', 'phrase', 'gå seg vill')).toBeUndefined();
    expect(verbMarker('nb', 'verb', 'å huske')).toBeUndefined();
    expect(verbMarker('de', 'verb', 'werfen')).toBeUndefined();
  });
  it('is said with the verb, as an article is with its noun', () => {
    expect(spokenEntry('nb', '', 'verb', 'huske')).toBe('å huske');
    expect(spokenEntry('nb', 'f', 'noun', 'huske')).toBe('ei huske');
    expect(spokenEntry('de', 'f', 'noun', 'Einstellung')).toBe('die Einstellung');
    expect(spokenEntry('pl', 'm', 'noun', 'stół')).toBe('ten stół');
    expect(spokenEntry('pl', 'pl', 'noun', 'spodnie')).toBe('te spodnie');
    expect(spokenEntry('pl', 'mpl', 'noun', 'ludzie')).toBe('ci ludzie');
    expect(spokenEntry('pl', 'm', 'noun', 'ten stół')).toBe('ten stół');
    expect(spokenEntry('ru', 'f', 'noun', 'кошка')).toBe('эта кошка');
    expect(spokenEntry('pl', '', 'noun', 'stół')).toBe('stół');
    expect(spokenEntry('th', 'm', 'noun', 'x')).toBe('x');
    expect(spokenEntry('de', '', 'verb', 'werfen')).toBe('werfen');
  });
  it('comes off a verb when the word is added', () => {
    expect(bareVerb('nb', 'verb', 'å huske')).toBe('huske');
    expect(bareVerb('nb', 'phrase', 'å gå seg vill')).toBe('å gå seg vill');
    expect(bareVerb('nb', 'verb', 'åpne')).toBe('åpne');
    expect(bareVerb('de', 'verb', 'werfen')).toBe('werfen');
  });
});

describe("Polish's plural gender words", () => {
  it('are te for Gender pl and ci for Gender mpl, before a bare Entry only', () => {
    expect(pluralWord('pl', 'pl', 'spodnie')).toBe('te');
    expect(pluralWord('pl', ' MPL ', 'ludzie')).toBe('ci');
    expect(pluralWord('pl', 'm', 'spodnie')).toBeUndefined();
    expect(pluralWord('pl', '', 'spodnie')).toBeUndefined();
    expect(pluralWord('de', 'pl', 'Einstellungen')).toBeUndefined();
    expect(pluralWord('pl', 'pl', 'te spodnie')).toBeUndefined();
  });
  it('are never added before an Entry that starts with a gender word of the language, whichever one', () => {
    for (const entry of ['ci ludzie', 'te drzwi', 'ten mężczyzna', 'ta kobieta', 'to dziecko']) {
      expect(genderArticle('pl', 'm', entry), entry).toBeUndefined();
      expect(pluralWord('pl', 'pl', entry), entry).toBeUndefined();
    }
    expect(genderArticle('pl', 'm', 'mężczyzna')).toBe('ten');
    expect(genderArticle('ru', 'f', 'эта кошка')).toBeUndefined();
  });
});
