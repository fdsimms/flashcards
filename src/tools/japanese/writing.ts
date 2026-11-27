import { wordItems, type WritingItem, type WritingLanguage } from '../writing';
import { JAPANESE_SCRIPT } from './script';

/*
 * Writing kana by hand: the 46 basic hiragana and the 25 written with ゛ or ゜, and the same
 * katakana, each from its sound in Hepburn romaji. Kana that sound the same as another are told
 * apart in the question: を is "o (the particle)", ぢ and づ name the kana they're written on.
 */
const HIRAGANA: [kana: string, romaji: string][] = [
  ['あ', 'a'], ['い', 'i'], ['う', 'u'], ['え', 'e'], ['お', 'o'],
  ['か', 'ka'], ['き', 'ki'], ['く', 'ku'], ['け', 'ke'], ['こ', 'ko'],
  ['さ', 'sa'], ['し', 'shi'], ['す', 'su'], ['せ', 'se'], ['そ', 'so'],
  ['た', 'ta'], ['ち', 'chi'], ['つ', 'tsu'], ['て', 'te'], ['と', 'to'],
  ['な', 'na'], ['に', 'ni'], ['ぬ', 'nu'], ['ね', 'ne'], ['の', 'no'],
  ['は', 'ha'], ['ひ', 'hi'], ['ふ', 'fu'], ['へ', 'he'], ['ほ', 'ho'],
  ['ま', 'ma'], ['み', 'mi'], ['む', 'mu'], ['め', 'me'], ['も', 'mo'],
  ['や', 'ya'], ['ゆ', 'yu'], ['よ', 'yo'],
  ['ら', 'ra'], ['り', 'ri'], ['る', 'ru'], ['れ', 're'], ['ろ', 'ro'],
  ['わ', 'wa'], ['を', 'o (the particle)'], ['ん', 'n'],
  ['が', 'ga'], ['ぎ', 'gi'], ['ぐ', 'gu'], ['げ', 'ge'], ['ご', 'go'],
  ['ざ', 'za'], ['じ', 'ji'], ['ず', 'zu'], ['ぜ', 'ze'], ['ぞ', 'zo'],
  ['だ', 'da'], ['ぢ', 'ji (on chi)'], ['づ', 'zu (on tsu)'], ['で', 'de'], ['ど', 'do'],
  ['ば', 'ba'], ['び', 'bi'], ['ぶ', 'bu'], ['べ', 'be'], ['ぼ', 'bo'],
  ['ぱ', 'pa'], ['ぴ', 'pi'], ['ぷ', 'pu'], ['ぺ', 'pe'], ['ぽ', 'po'],
];

/** Katakana sits 0x60 after hiragana in Unicode, kana for kana. */
const toKatakana = (hiragana: string): string => String.fromCodePoint(hiragana.codePointAt(0)! + 0x60);

const kana = (text: string, romaji: string, script: string): WritingItem => ({ text, prompt: romaji, detail: script, say: text, patterns: [`letter:${text}`] });

export const JAPANESE_WRITING: WritingLanguage = {
  letters: [
    ...HIRAGANA.map(([k, r]) => kana(k, r, 'Hiragana')),
    ...HIRAGANA.map(([k, r]) => kana(toKatakana(k), r, 'Katakana')),
  ],
  words: wordItems(JAPANESE_SCRIPT),
};
