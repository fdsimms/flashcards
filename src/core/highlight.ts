/** A piece of a line of text, and whether it is the word being highlighted. */
export interface Segment {
  text: string;
  marked: boolean;
}

// Scripts written without spaces between words: there, a word can only be found as a substring.
const UNSPACED = /[฀-๿぀-ヿ㐀-鿿]/;
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/**
 * Splits `text` around the first place `target` (a card's word, or any of several separated by
 * `;`, `,` or `/`) appears in it, so a card can highlight the word inside its example sentence.
 * In a spaced script the match has to be a whole word ("to" is not found in "tomato"); in Thai
 * and the like it can be any substring. With no match the whole text comes back unmarked, so a
 * word that's inflected in the sentence just isn't highlighted.
 */
export function markSegments(text: string, target: string): Segment[] {
  const lower = text.toLowerCase();
  // toLowerCase can change a string's length (a few capitals); offsets into it then don't apply.
  const haystack = lower.length === text.length ? lower : text;
  for (const part of target.split(/[;,/]/).map((p) => p.trim()).filter(Boolean)) {
    const needle = haystack === lower ? part.toLowerCase() : part;
    for (let from = 0; ; ) {
      const at = haystack.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      if (UNSPACED.test(needle) || (!isWordChar(text[at - 1]) && !isWordChar(text[end]))) {
        return [
          { text: text.slice(0, at), marked: false },
          { text: text.slice(at, end), marked: true },
          { text: text.slice(end), marked: false },
        ].filter((s) => s.text);
      }
      from = at + 1;
    }
  }
  return [{ text, marked: false }];
}
