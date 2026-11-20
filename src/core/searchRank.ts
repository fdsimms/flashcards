import { unaccented } from './letters';

/**
 * Ranking what a search found, closest first, shared by Browse (`searchNotes`) and Similar words'
 * search for a word to link (`searchWords`) so the two can't drift. A thing searched is a list of
 * places in the order they count (a note's front, its meaning, its other fields, its tags), and
 * the search is ranked by the first place that holds it and how well it holds it there.
 */

/** Text as search compares it: case folded, and again with accents too (`loose`). */
export type SearchPlace = { exact: string; loose: string; terms: Set<string>; looseTerms: Set<string> };
type Folded = { exact: string; loose: string };

const fold = (s: string) => s.toLocaleLowerCase();
const loosen = (s: string) => unaccented(s).replace(/ß/g, 'ss');

/**
 * A place's terms: the pieces a vocab field lists, split at ; , / and new lines, each without a
 * leading "1." or "a"/"an"/"the"/"to", so "1. to perform; to act" holds "perform" and "act".
 */
function termsOf(text: string): Set<string> {
  return new Set(
    text.split(/[;,/\n]|\s\d+\.\s/)
      .map((t) => t.replace(/^\s*\d+\.\s*/, '').replace(/^\s*(?:a|an|the|to)\s+/, '').replace(/[.!?]+$/, '').trim())
      .filter(Boolean),
  );
}

/** Plain text (HTML already taken off) as a place to search. */
export function searchPlace(text: string): SearchPlace {
  const exact = fold(text);
  const loose = loosen(exact);
  return { exact, loose, terms: termsOf(exact), looseTerms: termsOf(loose) };
}

// A letter, a combining mark (Thai's vowels and tones, a diacritic) or a digit: what a word is made of.
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * How well `text` holds `q`, lower is better: 0 one of its terms is exactly `q`, 1 `q` as a whole
 * word, 2 the start of a word, 3 anywhere; undefined when it isn't there at all.
 */
function matchQuality(text: string, terms: Set<string>, q: string): number | undefined {
  if (!q || !text.includes(q)) return undefined;
  if (terms.has(q)) return 0;
  let best = 3;
  for (const m of text.matchAll(new RegExp(escapeRegExp(q), 'gu'))) {
    const before = text[m.index - 1];
    const after = text[m.index + q.length];
    if (before && WORD_CHAR.test(before)) continue;
    if (!after || !WORD_CHAR.test(after)) return 1;
    best = 2;
  }
  return best;
}

/**
 * Where `q` is best found among `places`, lower is better: the first place holding it, then how
 * well it's held there; found only with accents aside ("zolw" for żółw), just behind the same
 * match with them.
 */
function placesRank(places: SearchPlace[], q: Folded): number | undefined {
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const exact = matchQuality(p.exact, p.terms, q.exact);
    if (exact !== undefined) return i * 4 + exact;
    const loose = matchQuality(p.loose, p.looseTerms, q.loose);
    if (loose !== undefined) return i * 4 + loose + 0.25;
  }
  return undefined;
}

/** A search as typed, folded once; empty when nothing but spaces was typed. */
export type SearchQuery = { phrase: Folded; words: Folded[] };

export function searchQuery(typed: string): SearchQuery {
  const exact = fold(typed.trim().replace(/\s+/g, ' '));
  const both = (s: string): Folded => ({ exact: s, loose: loosen(s) });
  return { phrase: both(exact), words: exact.split(' ').filter(Boolean).map(both) };
}

/**
 * How closely `places` match a search, lower is better, or undefined when a word of it isn't in
 * any of them. The search as one phrase ranks by where it's found; a search of several words that
 * isn't found together ranks by its worst-placed word, just behind a phrase matched as well.
 */
export function searchRank(places: SearchPlace[], query: SearchQuery): number | undefined {
  if (!query.words.length) return undefined;
  const whole = placesRank(places, query.phrase);
  if (whole !== undefined) return whole;
  let worst = 0;
  for (const w of query.words) {
    const rank = placesRank(places, w);
    if (rank === undefined) return undefined;
    worst = Math.max(worst, rank);
  }
  return worst + 0.5;
}
