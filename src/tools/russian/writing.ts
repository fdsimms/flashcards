import { wordItems, type WritingLanguage } from '../writing';
import { RUSSIAN_SCRIPT } from './script';

/*
 * Writing Russian by hand: each of the 33 letters, capital and small, from its name and its sound.
 * Printed or in joined handwriting is the screen's choice of face (writing.ts, `CURSIVE_LANGUAGES`).
 */
const LETTERS: [letter: string, name: string, sound: string][] = [
  ['а', 'a', 'a, as in "father"'], ['б', 'be', 'b'], ['в', 've', 'v'], ['г', 'ge', 'g, as in "go"'], ['д', 'de', 'd'],
  ['е', 'ye', 'ye, as in "yes"'], ['ё', 'yo', 'yo, as in "yonder"'], ['ж', 'zhe', 'zh, like the s in "measure"'], ['з', 'ze', 'z'],
  ['и', 'i', 'ee, as in "see"'], ['й', 'short i', 'y, as in "boy"'], ['к', 'ka', 'k'], ['л', 'el', 'l'], ['м', 'em', 'm'],
  ['н', 'en', 'n'], ['о', 'o', 'o, as in "more"'], ['п', 'pe', 'p'], ['р', 'er', 'a rolled r'], ['с', 'es', 's'], ['т', 'te', 't'],
  ['у', 'u', 'oo, as in "moon"'], ['ф', 'ef', 'f'], ['х', 'kha', 'kh, like the ch in "loch"'], ['ц', 'tse', 'ts, as in "cats"'],
  ['ч', 'che', 'ch, as in "chair"'], ['ш', 'sha', 'sh, as in "shop"'], ['щ', 'shcha', 'a long, soft sh'],
  ['ъ', 'hard sign', 'No sound of its own'], ['ы', 'y', 'Like the i in "bit", further back'], ['ь', 'soft sign', 'Softens the consonant before it'],
  ['э', 'e', 'e, as in "bed"'], ['ю', 'yu', 'yu, as in "you"'], ['я', 'ya', 'ya, as in "yard"'],
];

export const RUSSIAN_WRITING: WritingLanguage = {
  letters: LETTERS.map(([letter, name, sound]) => ({
    text: `${letter.toUpperCase()} ${letter}`,
    prompt: name,
    detail: sound,
    say: letter,
    patterns: [`letter:${letter}`],
  })),
  words: wordItems(RUSSIAN_SCRIPT),
};
