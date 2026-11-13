import { phoneGroups, type NumberQuestion, type NumberSaying } from '../number';
import type { Phrase, Word } from '../phrase';
import { japaneseNumber, nenWord, saiWord } from './numbers';

/*
 * A number in Japanese, in kanji with its reading, grouped by 万: 千二百七十七 せんにひゃくななじゅうなな.
 * A phone number is read digit by digit in kana, 0 as ゼロ, and each dash as の:
 * ゼロきゅうゼロの いちにさんよんの ごろくななはち. A year takes 年, an age 歳 and です: 三十四歳です.
 * Twenty years old is はたち.
 */

const word = ([text, roman]: Word, note?: string): Phrase => ({ text, roman, ...(note ? { note } : {}) });

/** The digits as a phone number is read: ゼロ for 0, よん, なな and きゅう for 4, 7 and 9. */
const DIGITS = ['ゼロ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];

export function sayJapaneseNumber(q: NumberQuestion): NumberSaying {
  switch (q.kind) {
    case 'number': return { everyday: word(japaneseNumber(q.n)), also: [] };
    case 'phone': {
      const groups = phoneGroups(q.written).map((g) => [...g].map((d) => DIGITS[Number(d)]).join(''));
      // Already in kana: no reading under it.
      return { everyday: { text: groups.join('の ') }, also: [] };
    }
    case 'year': return { everyday: word(nenWord(q.n)), also: [] };
    case 'age': {
      const [text, reading] = saiWord(q.n);
      if (q.n === 20) return { everyday: word([`${text}です`, 'はたちです']), also: [word([`${text}です`, `${reading}です`], 'Heard too')] };
      return { everyday: word([`${text}です`, `${reading}です`]), also: [] };
    }
  }
}
