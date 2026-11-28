// Whether a deck has a word, one definition for skill cards and Practice's tools alike.
// The MCP's mirror of it is omnilanguage.loose_spelling.

/**
 * A word as it is compared: lowercase, Russian ё as е, and Greek's tone marks off, since decks write
 * четвертый and μια as often as четвёртый and μία. Other accents stay (Polish ę, ł and ś are letters of their own).
 */
const norm = (w: string) => w.normalize('NFC').toLocaleLowerCase().replace(/ё/g, 'е').normalize('NFD').replace(/(?<=[\u0370-\u03ff][\u0300-\u036f]*)[\u0300-\u036f]/g, '').normalize('NFC').trim();

/**
 * The words of `words` the known headwords have: one counts when a headword is it, or has it as a
 * word of its own ("luty" in "luty, miesiąc"). Thai and Japanese aren't written with spaces, so
 * there it has to be the whole headword.
 */
export function knownAmong(words: readonly string[], headwords: readonly string[]): boolean[] {
  const known = new Set(headwords.flatMap((t) => [norm(t), ...norm(t).split(/[^\p{L}\p{N}]+/u)]).filter(Boolean));
  return words.map((w) => known.has(norm(w)));
}
