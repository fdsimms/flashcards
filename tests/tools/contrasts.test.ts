import { describe, expect, it } from 'vitest';
import { contrastKey, contrastSet, contrastSetsFor, contrastTitle, drawSentence, missingWords, nextContrast, setsKnown, showSentence, type ContrastSet } from '../../src/tools/contrasts';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

const word = (w: string) => ({ word: w, rule: `${w} rule` });
const sentence = (text: string, answer: number) => ({ tokens: text.split(' '), answer, english: text });
const A: ContrastSet = { id: 'es-a', words: [word('por'), word('para')], sentences: [sentence('lo hice _ ti', 1), sentence('gracias _ todo', 0), sentence('salgo _ Madrid', 1)] };
const B: ContrastSet = { id: 'es-b', words: [word('ser'), word('estar')], sentences: [sentence('quiero _ médico', 0)] };

describe('Which word fits', () => {
  it('finds a set and its language by id, and names it by its words', () => {
    expect(contrastSet('th-jon')?.language).toBe('th');
    expect(contrastSet('nope')).toBeUndefined();
    expect(contrastTitle(contrastSetsFor('th')[0])).toBe('จน / จนกว่า');
    expect(contrastSetsFor('pl')).toEqual([]);
  });

  it('joins words with spaces in a language that has them', () => {
    expect(showSentence(A, 0, 'es')).toMatchObject({ before: 'lo hice ', after: ' ti', filled: 'lo hice para ti' });
    expect(showSentence(A, 9, 'es')).toBeUndefined();
  });

  it('offers only sets whose every word is studied', () => {
    expect(missingWords(A, ['Por', 'ser'])).toEqual(['para']);
    expect(setsKnown([A, B], ['por', 'para', 'ser']).map((s) => s.id)).toEqual(['es-a']);
  });

  it('asks a sentence not asked lately, and only from the set chosen', () => {
    const asked = ['es-a:0', 'es-a:1'];
    expect(nextContrast([A, B], undefined, asked, seq([0]))).toEqual({ setId: 'es-a', index: 2 });
    expect(nextContrast([A, B], 'es-b', [], seq([0.9]))).toEqual({ setId: 'es-b', index: 0 });
    // Everything asked lately: still a question, but not the very last one.
    for (let i = 0; i < 10; i++) expect(contrastKey(nextContrast([A], undefined, ['es-a:0', 'es-a:1', 'es-a:2'], Math.random)!)).not.toBe('es-a:2');
    // A set of one sentence asks it again.
    expect(nextContrast([B], undefined, ['es-b:0'], Math.random)).toEqual({ setId: 'es-b', index: 0 });
    expect(nextContrast([], undefined, [], Math.random)).toBeUndefined();
  });

  it('draws a sentence other than the one before', () => {
    for (let i = 0; i < 20; i++) expect(drawSentence(A, 1, Math.random)).not.toBe(1);
    expect(drawSentence(B, 0, Math.random)).toBe(0);
    expect(drawSentence(A, undefined, seq([0.99]))).toBe(2);
  });
});
