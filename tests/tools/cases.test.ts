import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/core/types';
import {
  CASE_CUES, CASE_LANGUAGES, caseNouns, caseRows, casePatterns, caseRule, checkCaseForm, drawGovernor, governorId, governorNote, inDeck,
  languageDeck, nounFor, type Governor,
} from '../../src/tools/cases';
import { omniNote } from '../support/fixtures';

const pl = (id: string, Entry: string, Meaning: string, Forms = '', tags: string[] = ['noun'], deck = 'Languages::Polski'): Note =>
  ({ ...omniNote({ Entry, Meaning, Language: 'polish', Forms }), id, deck, tags });

const PTAK = [
  'genitive · singular: ptaka', 'genitive · plural: ptaków',
  'dative · singular: ptakowi', 'accusative · singular: ptaka', 'instrumental · singular: ptakiem', 'locative · singular: ptaku',
].join('<br>');
const MAMA = ['genitive · singular: mamy', 'dative · singular: mamie', 'instrumental · singular: mamą'].join('<br>');
const BUTY = ['genitive · plural: butów', 'dative · plural: butom'].join('<br>');

const notes = [
  pl('ptak', 'ten ptak', 'bird', PTAK),
  pl('mama', 'ta mama', 'mom', MAMA, ['family', 'noun']),
  pl('buty', 'te buty', 'shoes', BUTY),
  pl('new', 'ten kot', 'cat', PTAK.replace(/ptak/g, 'kot')),
  pl('mieć', 'mieć', 'to have', '', ['verb']),
  pl('dzwonić', 'dzwonić / zadzwonić', 'to call', '', ['verb']),
  pl('sub', 'stół', 'table', '', ['noun'], 'Languages::Polski::Przypadki'),
  { ...omniNote({ Entry: 'der Hund', Meaning: 'dog', Language: 'german', Forms: 'genitive · singular: des Hundes' }), id: 'hund', deck: 'Languages::Deutsch', tags: ['noun'] },
];
const studied = new Set(['ptak', 'mama', 'buty', 'hund']);
const polish = CASE_LANGUAGES.pl!;
const gov = (word: string, sense?: string): Governor => polish.governors.find((g) => g.word === word && g.sense === sense)!;

describe('the case lists', () => {
  it('cover Polish, Russian, German and Greek', () => {
    expect(Object.keys(CASE_LANGUAGES).sort()).toEqual(['de', 'el', 'pl', 'ru']);
  });

  it("name only a case the language's choices offer, each word once per sense", () => {
    for (const [l, cl] of Object.entries(CASE_LANGUAGES)) {
      for (const g of cl!.governors) expect(cl!.cases, `${l} ${g.word}`).toContain(g.case);
      const ids = cl!.governors.map(governorId);
      expect(new Set(ids).size, l).toBe(ids.length);
      // Every case offered is the answer to at least one word, so no choice is a dead one.
      for (const k of cl!.cases) expect(cl!.governors.some((g) => g.case === k), `${l} ${k}`).toBe(true);
    }
  });

  it('give a sense to every word that takes two cases', () => {
    for (const [l, cl] of Object.entries(CASE_LANGUAGES)) {
      for (const g of cl!.governors) {
        const twice = cl!.governors.filter((o) => o.word === g.word).length > 1;
        if (twice) expect(g.sense, `${l} ${g.word}`).toBeTruthy();
      }
    }
  });
});

describe('caseNouns', () => {
  it("takes studied nouns of the language with a case listed, the singular, else the plural", () => {
    const nouns = caseNouns(notes, studied, 'pl');
    expect(nouns.map((n) => n.note.id)).toEqual(['ptak', 'mama', 'buty']);
    expect(nouns[0].forms.genitive).toEqual(['ptaka']);
    expect(nouns[2].forms.genitive).toEqual(['butów']);
    expect(nouns[1].person).toBe(true);
    expect(nouns[0].person).toBe(false);
  });
});

describe('nounFor', () => {
  const nouns = caseNouns(notes, studied, 'pl');
  it('draws a noun with the case listed', () => {
    expect(nounFor(gov('nad'), nouns, () => 0)?.note.id).toBe('ptak');
    expect(nounFor(gov('o'), nouns, () => 0.99)?.note.id).toBe('ptak');
  });
  it('draws only a person after a word only a person follows', () => {
    expect(nounFor(gov('pomagać'), nouns, () => 0)?.note.id).toBe('mama');
  });
  it('has none when no noun lists the case', () => {
    expect(nounFor(gov('z'), [nouns[2]])).toBeUndefined();
  });
});

describe('drawGovernor', () => {
  it('never asks the same word and sense twice in a row', () => {
    const first = polish.governors[0];
    for (let i = 0; i < 20; i++) expect(governorId(drawGovernor(polish, governorId(first), () => 0))).not.toBe(governorId(first));
  });
});

describe('checkCaseForm', () => {
  const ptak = caseNouns(notes, studied, 'pl')[0];
  it('checks the typed form against the case', () => {
    expect(checkCaseForm('ptaka', gov('bez'), ptak)).toBe('right');
    expect(checkCaseForm(' Ptaka ', gov('bez'), ptak)).toBe('right');
    expect(checkCaseForm('ptakiem', gov('bez'), ptak)).toBe('wrong');
    expect(checkCaseForm('ptakiem', gov('z'), ptak)).toBe('right');
  });
});

describe('casePatterns and caseRule', () => {
  it('marks a question by its word and its case', () => {
    expect(casePatterns(gov('na', 'motion'))).toEqual(['word:na (motion)', 'case:accusative']);
  });
  it('names the case, the sense, and others of the same kind that take it', () => {
    expect(caseRule(polish, gov('bez'))).toBe('bez takes the genitive. So do dla, od, do, u.');
    expect(caseRule(polish, gov('na', 'location'))).toMatch(/^na takes the locative for location\. So do o, w, przy, po\.$/);
  });
});

describe('inDeck, languageDeck and governorNote', () => {
  it('finds a word as an entry, or one of its alternatives', () => {
    expect(inDeck(gov('mieć'), notes, 'pl')).toBe(true);
    expect(inDeck(gov('dzwonić do'), notes, 'pl')).toBe(true);
    expect(inDeck(gov('bez'), notes, 'pl')).toBe(false);
  });
  it("adds to the deck holding most of the language's notes", () => {
    expect(languageDeck(notes, 'pl')).toBe('Languages::Polski');
    expect(languageDeck(notes, 'ru')).toBeUndefined();
  });
  it('fills a note with every case the entry takes', () => {
    const { fields, tags } = governorNote(polish, gov('na', 'motion'), 'polish');
    expect(fields).toEqual({
      Entry: 'na', Meaning: 'onto; on, at', Language: 'polish', PartOfSpeech: 'preposition',
      Notes: 'Takes the accusative for motion, the locative for location.',
    });
    expect(tags).toEqual(['preposition']);
    expect(governorNote(polish, gov('dzwonić do'), 'polish').fields.Entry).toBe('dzwonić');
  });
});

describe('the case choices', () => {
  it('has a cue for every case any language asks', () => {
    for (const language of Object.values(CASE_LANGUAGES)) {
      for (const k of language!.cases) expect(CASE_CUES[k], k).toBeTruthy();
    }
  });

  it('lays the choices out in rows of at most three', () => {
    expect(caseRows(2)).toEqual([2]);
    expect(caseRows(3)).toEqual([3]);
    expect(caseRows(4)).toEqual([2, 2]);
    expect(caseRows(5)).toEqual([3, 2]);
    expect(caseRows(6)).toEqual([3, 3]);
    for (const language of Object.values(CASE_LANGUAGES)) {
      const n = language!.cases.length;
      expect(caseRows(n).reduce((a, b) => a + b, 0)).toBe(n);
    }
  });
});
