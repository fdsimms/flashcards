import { wordItems, type WritingLanguage } from '../writing';
import { CLASS_NAMES, CONSONANTS, VOWELS, vowelSyllable } from './letters';
import { THAI_SCRIPT } from './script';

/*
 * Writing Thai by hand: each consonant from its name (the two no longer used in any word are left
 * out), and each vowel on ก from its sound and a word that has it, which tells ไ from ใ.
 */
export const THAI_WRITING: WritingLanguage = {
  letters: [
    ...CONSONANTS.filter((c) => c.rarity !== 'obsolete').map((c) => ({
      text: c.letter,
      prompt: c.name,
      detail: `${c.meaning}, ${CLASS_NAMES[c.cls].toLowerCase()} class`,
      say: c.say,
      patterns: [`letter:${c.letter}`],
    })),
    ...VOWELS.map((v) => ({
      text: v.shown,
      prompt: vowelSyllable(v),
      detail: `${v.long ? 'Long' : 'Short'} vowel on ก, as in ${v.example.roman} (${v.example.meaning})`,
      say: v.shown,
      patterns: [`letter:${v.shown}`],
    })),
  ],
  words: wordItems(THAI_SCRIPT),
};
