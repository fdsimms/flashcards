import { describe, expect, it } from 'vitest';
import { CONTRAST_SETS, isGap, showSentence, type ContrastSet } from '../../src/tools/contrasts';
import { plainSet } from '../../src/tools/contrastBuild';
import type { Language } from '../../src/reader/api';

/** The rules every language's Which word fits sets keep (Thai's romanization has its own test, tests/tools/thai/contrasts.test.ts). */
const all = Object.entries(CONTRAST_SETS) as [Language, readonly ContrastSet[]][];

describe('every Which word fits set', () => {
  it('has an id that starts with its language and is unique across languages', () => {
    const ids = all.flatMap(([, sets]) => sets.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const [language, sets] of all) for (const s of sets) expect(s.id.startsWith(`${language}-`), s.id).toBe(true);
  });

  it('has at least two words with rules, and ten sentences that between them use every word', () => {
    for (const [, sets] of all) {
      for (const set of sets) {
        expect(set.words.length, set.id).toBeGreaterThanOrEqual(2);
        for (const w of set.words) expect(w.rule.trim(), w.word).not.toBe('');
        expect(set.sentences.length, set.id).toBeGreaterThanOrEqual(10);
        for (let i = 0; i < set.words.length; i++) expect(set.sentences.some((s) => s.answer === i), `${set.id}: ${set.words[i].word}`).toBe(true);
      }
    }
  });

  it('puts one gap in each sentence, an answer from the set, English, and no repeat', () => {
    for (const [language, sets] of all) {
      for (const set of sets) {
        const texts = set.sentences.map((s) => s.tokens.join(' '));
        expect(new Set(texts).size, set.id).toBe(texts.length);
        set.sentences.forEach((s, i) => {
          const where = `${set.id}: ${s.tokens.join(' ')}`;
          expect(s.tokens.filter(isGap), where).toHaveLength(1);
          expect(set.words[s.answer], where).toBeDefined();
          expect(s.english.trim(), where).not.toBe('');
          expect(showSentence(set, i, language)?.filled, where).toBeTruthy();
        });
      }
    }
  });

  it('keeps em dashes out of what is shown', () => {
    for (const [, sets] of all) {
      for (const set of sets) {
        for (const w of set.words) expect(w.rule).not.toContain('—');
        for (const s of set.sentences) expect(s.english).not.toContain('—');
      }
    }
  });
});

describe('a sentence in a language with spaces', () => {
  const set = plainSet('de-x', [{ word: 'fragen', rule: 'r' }, { word: 'bitten', rule: 'r' }], [
    ['Er hat mich um Hilfe _.', 1, 'He asked me for help.', 'gebeten'],
    ['_ doch den Lehrer!', 0, 'Just ask the teacher!', 'Frag'],
    ['Nie _, gdzie on mieszka.', 0, "I don't know where he lives.", 'wiem'],
    ['Darf ich dich etwas _?', 0, 'Can I ask you something?'],
  ]);

  it('fills the gap with the form the sentence takes, punctuation after it kept', () => {
    expect(showSentence(set, 0, 'de')).toMatchObject({ before: 'Er hat mich um Hilfe ', after: '.', fill: 'gebeten', filled: 'Er hat mich um Hilfe gebeten.' });
    expect(showSentence(set, 1, 'de')).toMatchObject({ before: '', after: ' doch den Lehrer!', fill: 'Frag', filled: 'Frag doch den Lehrer!' });
    expect(showSentence(set, 2, 'pl')).toMatchObject({ before: 'Nie ', after: ', gdzie on mieszka.', filled: 'Nie wiem, gdzie on mieszka.' });
  });

  it('uses the word itself when the sentence gives no form', () => {
    expect(showSentence(set, 3, 'de')).toMatchObject({ fill: 'fragen', filled: 'Darf ich dich etwas fragen?' });
  });
});
