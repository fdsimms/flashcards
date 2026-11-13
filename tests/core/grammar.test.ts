import { describe, expect, it } from 'vitest';
import { explanationParagraphs, GRAMMAR_POINTS, grammarPoint, grammarPointForForms, grammarPointsFor, type GrammarLanguage } from '../../src/core/grammar';
import type { Language } from '../../src/reader/api';

// The catalog's languages are Read & Listen's: tsc fails here if one list gains a language the other hasn't.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameLanguages: Same<GrammarLanguage, Language> = true;
const LANGUAGES: GrammarLanguage[] = ['th', 'es', 'de', 'fr', 'ru', 'el', 'pl', 'nb', 'ja', 'en'];

describe('the grammar catalog', () => {
  it('gives every point a unique id in its own language, a name and a note', () => {
    expect(sameLanguages).toBe(true);
    const ids = GRAMMAR_POINTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of GRAMMAR_POINTS) {
      expect(LANGUAGES).toContain(p.language);
      expect(p.id.startsWith(`${p.language}.`)).toBe(true);
      expect(p.name.trim()).not.toBe('');
      expect(p.note.trim()).not.toBe('');
      // Shown on the Grammar screen and in the reader.
      expect(`${p.name} ${p.note}`).not.toContain('—');
    }
  });

  it('gives a JLPT level of 1 to 5 to every Japanese point and to no other language', () => {
    for (const p of GRAMMAR_POINTS) {
      if (p.language === 'ja') expect([1, 2, 3, 4, 5]).toContain(p.jlpt);
      else expect(p.jlpt).toBeUndefined();
    }
  });

  it('has points for every language but English, which the learner already reads', () => {
    for (const language of LANGUAGES.filter((l) => l !== 'en')) expect(grammarPointsFor(language).length).toBeGreaterThan(0);
  });

  it('links a Forms group to one point at most in each language', () => {
    for (const language of LANGUAGES) {
      const groups = grammarPointsFor(language).flatMap((p) => p.forms.map((f) => f.toLocaleLowerCase()));
      expect(new Set(groups).size).toBe(groups.length);
    }
  });
});

describe('grammarPointForForms', () => {
  it("finds the point a Forms group is, in the note's language", () => {
    expect(grammarPointForForms('es', 'preterite')?.id).toBe('es.preterite');
    expect(grammarPointForForms('es', 'present subjunctive')?.id).toBe('es.present_subjunctive');
    expect(grammarPointForForms('pl', 'past')?.id).toBe('pl.past');
    expect(grammarPointForForms('ru', 'past')?.id).toBe('ru.past');
  });

  it('matches a hand-written group whatever its case or spacing', () => {
    expect(grammarPointForForms('es', ' Preterite ')?.id).toBe('es.preterite');
  });

  it('finds nothing for a group no point covers, or a language with no points', () => {
    expect(grammarPointForForms('es', 'present')).toBeUndefined();
    expect(grammarPointForForms('pl', 'preterite')).toBeUndefined();
    expect(grammarPointForForms('it', 'past')).toBeUndefined();
  });
});

describe("each point's page", () => {
  it('has an explanation for every point, with marked words and no em dashes, as it is shown', () => {
    for (const p of GRAMMAR_POINTS) {
      expect(p.explanation.trim(), p.id).not.toBe('');
      expect(p.explanation, p.id).not.toContain('\u2014');
      expect(p.explanation.split('**').length % 2, `${p.id} has an unclosed **`).toBe(1);
      expect(explanationParagraphs(p.explanation).some((para) => para.some((run) => run.language)), p.id).toBe(true);
    }
  });

  it('relates a point only to other points in its own language', () => {
    for (const p of GRAMMAR_POINTS) {
      for (const id of p.related) {
        expect(id, p.id).not.toBe(p.id);
        expect(grammarPoint(id)?.language, `${p.id} -> ${id}`).toBe(p.language);
      }
    }
  });

  it('splits an explanation into paragraphs and marks the words in the language', () => {
    expect(explanationParagraphs('Say **hola**, "hello".\n\n**Adiós** is "bye".')).toEqual([
      [{ text: 'Say ', language: false }, { text: 'hola', language: true }, { text: ', "hello".', language: false }],
      [{ text: 'Adiós', language: true }, { text: ' is "bye".', language: false }],
    ]);
    expect(grammarPoint('es.preterite')?.related).toEqual(['es.imperfect', 'es.present_perfect']);
    expect(grammarPoint('es.nope')).toBeUndefined();
  });
});
