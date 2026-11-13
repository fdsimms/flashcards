import { htmlToText } from './html';

/** A piece of a line of text, and whether it is the word being highlighted. */
export interface Segment {
  text: string;
  marked: boolean;
}

// Scripts written without spaces between words: there, a word can only be found as a substring.
const UNSPACED = /[฀-๿぀-ヿ㐀-鿿]/;
const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/**
 * Where `needle` first appears in `haystack` from `from` on, as a word: in a spaced script, with no
 * letter or digit either side ("να" isn't found in "ένα"); in Thai and the like, anywhere. -1 if
 * it doesn't. Case is the caller's to fold.
 */
export function wordIndex(haystack: string, needle: string, from = 0): number {
  if (!needle) return -1;
  for (let i = from; ; i++) {
    const at = haystack.indexOf(needle, i);
    if (at < 0 || UNSPACED.test(needle) || (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[at + needle.length]))) return at;
    i = at;
  }
}

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
    const at = wordIndex(haystack, needle);
    if (at >= 0) {
      const end = at + needle.length;
      return [
        { text: text.slice(0, at), marked: false },
        { text: text.slice(at, end), marked: true },
        { text: text.slice(end), marked: false },
      ].filter((s) => s.text);
    }
  }
  return [{ text, marked: false }];
}

// Stand-ins for a bold span's ends while the rest of the field's HTML is turned into text.
const OPEN = '\u0001';
const CLOSE = '\u0002';

/**
 * An example sentence's field split for highlighting. Words the note marks in bold (`<b>` or
 * `<strong>`) are the highlight, so an inflected form ("Einstellungen" for "die Einstellung") or
 * a split verb ("warf … ab") is picked out exactly as written. A field with nothing in bold falls
 * back to finding `target` in it (`markSegments`).
 */
export function fieldSegments(html: string | undefined, target: string): Segment[] {
  const tagged = (html ?? '')
    .replace(/<\s*(b|strong)(\s[^>]*)?>/gi, OPEN)
    .replace(/<\s*\/\s*(b|strong)\s*>/gi, CLOSE);
  const text = htmlToText(tagged);
  if (!text.includes(OPEN)) return markSegments(text, target);
  const out: Segment[] = [];
  let marked = false;
  for (const piece of text.split(/([\u0001\u0002])/)) {
    if (piece === OPEN) marked = true;
    else if (piece === CLOSE) marked = false;
    else if (piece) {
      const last = out[out.length - 1];
      if (last && last.marked === marked) last.text += piece;
      else out.push({ text: piece, marked });
    }
  }
  return out;
}
