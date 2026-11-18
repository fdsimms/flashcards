import { describe, expect, it } from 'vitest';
import { CLASSES, classMembers, CONSONANTS, consonantPatterns, consonantSteps, VOWELS, vowelPatterns, vowelSteps, vowelSyllable } from '../../../src/tools/thai/letters';

describe('the Thai consonants', () => {
  it('are the 44 letters, each once', () => {
    expect(CONSONANTS).toHaveLength(44);
    expect(new Set(CONSONANTS.map((c) => c.letter)).size).toBe(44);
    // Every letter from ก to ฮ except the two consonant-vowels ฤ and ฦ.
    const all: string[] = [];
    for (let code = 0x0e01; code <= 0x0e2e; code++) if (code !== 0x0e24 && code !== 0x0e26) all.push(String.fromCharCode(code));
    expect(CONSONANTS.map((c) => c.letter).sort()).toEqual(all.sort());
  });

  it('split 9 middle, 11 high and 24 low', () => {
    expect(CLASSES.map((cls) => classMembers(cls).length)).toEqual([9, 11, 24]);
  });

  it('have a word that starts with the letter and a name that is its sound with อ and that word', () => {
    for (const c of CONSONANTS) {
      expect(c.word, c.letter).toContain(c.letter);
      expect(c.say.endsWith(c.word), c.letter).toBe(true);
      expect(c.say, c.letter).toMatch(/^\S+อ /u);
    }
  });

  it('close a syllable only with the eight final sounds, and อ, ห and ฮ not at all', () => {
    const finals = new Set(CONSONANTS.map((c) => c.final).filter(Boolean));
    expect([...finals].sort()).toEqual(['k', 'm', 'n', 'ng', 'p', 't', 'w', 'y']);
    for (const letter of ['อ', 'ห', 'ฮ']) expect(CONSONANTS.find((c) => c.letter === letter)!.final).toBeUndefined();
    expect(CONSONANTS.filter((c) => c.initial === '').map((c) => c.letter)).toEqual(['อ']);
  });

  it('mark the two letters no word uses, and name them in the steps', () => {
    expect(CONSONANTS.filter((c) => c.rarity === 'obsolete').map((c) => c.letter)).toEqual(['ฃ', 'ฅ']);
    expect(consonantSteps(CONSONANTS.find((c) => c.letter === 'ฃ')!)).toContain('Not used in any word today.');
  });

  it('explain how the letter sounds and which class it is in', () => {
    const ko = CONSONANTS[0];
    expect(consonantSteps(ko)).toEqual(['Sounds like g at the start of a syllable and k at the end.', 'Middle class: ก จ ด ต ฎ ฏ บ ป อ.']);
    expect(consonantSteps(CONSONANTS.find((c) => c.letter === 'อ')!)[0]).toContain('holds a vowel');
    expect(consonantSteps(CONSONANTS.find((c) => c.letter === 'ห')!)[0]).toContain("doesn't close a syllable");
    expect(consonantPatterns(ko)).toEqual(['letter:ก', 'letter-class:mid']);
  });
});

describe('the Thai vowels', () => {
  it('are each written once, 8 short and 12 long', () => {
    expect(new Set(VOWELS.map((v) => v.shown)).size).toBe(VOWELS.length);
    expect(VOWELS.filter((v) => !v.long)).toHaveLength(8);
    expect(VOWELS.filter((v) => v.long)).toHaveLength(12);
  });

  it('are shown on ก, and a long sound is written with a double letter or a diphthong', () => {
    for (const v of VOWELS) {
      expect(v.shown, v.shown).toContain('ก');
      expect(v.example.text, v.shown).toBeTruthy();
    }
    expect(VOWELS.filter((v) => v.long && v.sound.length === 1)).toEqual([]);
  });

  it('say the vowel with ก, and explain why the length matters', () => {
    const aa = VOWELS.find((v) => v.shown === 'กา')!;
    expect(vowelSyllable(aa)).toBe('gaa');
    expect(vowelSteps(aa)).toEqual(['A, as in "father". Example: มา (maa), come.', "A long vowel makes the syllable live, so with no tone mark it keeps its class's own tone."]);
    expect(vowelSteps(VOWELS[0])[1]).toContain('dead');
    expect(vowelPatterns(aa)).toEqual(['vowel:กา', 'vowel-length:long']);
  });
});
