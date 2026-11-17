import { describe, expect, it } from 'vitest';
import { isKana } from '../../../src/core/kana';
import { JAPANESE_SCRIPT as ja } from '../../../src/tools/japanese/script';
import { SCRIPTS } from '../../../src/tools/tools';

const find = (shown: string) => ja.words.findIndex((w) => w.shown === shown);

describe('reading kana aloud', () => {
  it('is a Reading the script language', () => {
    expect(SCRIPTS.ja).toBe(ja);
  });

  it('shows every word in kana, and answers in romaji', () => {
    for (const w of ja.words) {
      expect(isKana(w.shown), w.shown).toBe(true);
      expect(w.answer.text).toBe(w.shown);
      expect(w.answer.roman, w.shown).toMatch(/^[a-zāīūēō']+$/);
    }
    expect(new Set(ja.words.map((w) => w.shown)).size).toBe(ja.words.length);
  });

  it('explains a small っ and a small ゃ, ゅ or ょ', () => {
    expect(ja.rule(find('きって'))).toBe('A small っ doubles the consonant after it, with a short stop before it.');
    expect(ja.patterns(find('ちょっと'))).toEqual(['small-tsu', 'small-ya']);
    expect(ja.rule(find('ベッド'))).toContain('A small ッ');
  });

  it("explains a long vowel, katakana's ー or hiragana's vowel kana", () => {
    expect(ja.rule(find('コーヒー'))).toBe('ー makes the vowel before it long.');
    expect(ja.rule(find('がっこう'))).toContain('う after an o makes it a long ō.');
    expect(ja.rule(find('せんせい'))).toBe('い after an e makes it a long ē.');
    expect(ja.patterns(find('おばさん'))).toEqual([]);
    expect(ja.rule(find('おばさん'))).toBeUndefined();
  });

  it('explains an ん read on its own, and a small vowel in katakana', () => {
    expect(ja.rule(find('ほんや'))).toBe("ん is a syllable of its own, so the next vowel or y starts a new one: hon'ya.");
    expect(ja.patterns(find('フォーク'))).toEqual(['long-mark', 'small-vowel']);
  });
});
