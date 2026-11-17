/**
 * Grammatical gender for coloring: the Gender field's m / f / n, and the article a word starts with.
 * Display only, never an input to anything. Pure, so it's tested.
 */

export type Gender = 'm' | 'f' | 'n';

/** The Gender field as a gender, or undefined for anything else (empty, "mf", "pl"): those are shown as written and not colored. */
export function genderOf(value: string): Gender | undefined {
  const v = value.trim().toLowerCase();
  return v === 'm' || v === 'f' || v === 'n' ? v : undefined;
}

/**
 * The articles an Entry may start with, in the languages the decks have (German der/die/das, Spanish
 * el/la/lo, French le/la, Italian il, Greek ο/η/το, Norwegian en/ei/et). Which gender each is isn't
 * looked up: the note's Gender field says, and a word starting with one of these is a word with an article.
 */
const ARTICLES = new Set(['der', 'die', 'das', 'el', 'la', 'lo', 'le', 'il', 'ο', 'η', 'το', 'en', 'ei', 'et', 'ett']);

/** An entry split into its leading article and the rest, or null when it doesn't start with one. */
export function leadingArticle(entry: string): { article: string; rest: string } | null {
  const m = /^(\S+)(\s+)(\S.*)$/su.exec(entry.trim());
  if (!m || !ARTICLES.has(m[1].toLowerCase())) return null;
  return { article: m[1], rest: `${m[2]}${m[3]}` };
}
