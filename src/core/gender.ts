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
 * el/la/lo, French le/la/l', Italian il, Greek ο/η/το, Norwegian en/ei/et, and the plurals a plural-only noun keeps: los, las, les, οι, τα). Which gender each is isn't
 * looked up: the note's Gender field says, and a word starting with one of these is a word with an article.
 */
const ARTICLES = new Set(['der', 'die', 'das', 'el', 'la', 'lo', 'le', 'il', 'ο', 'η', 'το', 'en', 'ei', 'et', 'ett', 'los', 'las', 'les', 'οι', 'τα']);

/** French and Italian drop the article's vowel before a vowel: l'amertume, with no space. */
const ELISION = /^l['’](?=\S)/iu;

/** An entry split into its leading article and the rest, or null when it doesn't start with one. */
export function leadingArticle(entry: string): { article: string; rest: string } | null {
  const elided = ELISION.exec(entry.trim());
  if (elided) return { article: elided[0], rest: entry.trim().slice(elided[0].length) };
  const m = /^(\S+)(\s+)(\S.*)$/su.exec(entry.trim());
  if (!m || !ARTICLES.has(m[1].toLowerCase())) return null;
  return { article: m[1], rest: `${m[2]}${m[3]}` };
}

/**
 * The word shown dimmed before a noun, by the noun's Gender and its language (the first two letters of its
 * speech language). The Entry is the bare noun and the card puts this before it; Anki's template (Omnilanguage)
 * puts the same word there. Russian's and Polish's is a demonstrative (этот / эта / это, ten / ta / to) that
 * does the job of an article, so it is said with the word like a real one (`SPOKEN_ARTICLE`): the audio says what
 * the card shows.
 */
const GENDER_PREFIXES: Record<string, Partial<Record<Gender, string>>> = {
  ru: { m: 'этот', f: 'эта', n: 'это' },
  pl: { m: 'ten', f: 'ta', n: 'to' },
  es: { m: 'el', f: 'la' },
  nb: { m: 'en', f: 'ei', n: 'et' },
  de: { m: 'der', f: 'die', n: 'das' },
  fr: { m: 'le', f: 'la' },
  el: { m: 'ο', f: 'η', n: 'το' },
};
const SPOKEN_ARTICLE = new Set(['es', 'nb', 'de', 'fr', 'el', 'ru', 'pl']);

/**
 * Polish's gender words for a plural, by the Gender field's value: te before a noun that has only a plural
 * (pl: te spodnie) and ci before a plural of men (mpl: ci ludzie). They aren't a `Gender`, which is m, f or n,
 * so they have their own lookup (`pluralWord`).
 */
const PLURAL_PREFIXES: Record<string, Record<string, string>> = { pl: { pl: 'te', mpl: 'ci' } };

/** Whether an Entry already starts with one of the language's gender words (ten, te, ci, мой, el): it must not get a second. */
function startsWithGenderWord(lang: string, entry: string): boolean {
  const words = [...Object.values(GENDER_PREFIXES[lang] ?? {}), ...Object.values(PLURAL_PREFIXES[lang] ?? {})];
  const e = entry.toLowerCase();
  return words.some((w) => e.startsWith(`${w} `));
}

/**
 * Whether a French or Italian word takes l' in place of its gender's article: a vowel starts it. The Forms
 * practice asks the same question, so it's one function. A French h goes either way (l'homme, le héros), so
 * it's not decided here: such a noun keeps its article in the Entry.
 */
export function elidesBefore(lang: string, word: string): boolean {
  return (lang === 'fr' || lang === 'it') && /^[aeiouàâäéèêëìíîïòóôöùúûüœæ]/iu.test(word);
}

/**
 * The article to show before a bare Entry, or undefined: no gender, a language with no table, or an Entry that
 * already starts with its own article. That is how an exception is written (el agua, l'homme, en bok said
 * with a feminine noun), and it must not get a second one.
 */
export function genderArticle(lang: string, gender: Gender | undefined, entry: string): string | undefined {
  const word = gender ? GENDER_PREFIXES[lang]?.[gender] : undefined;
  if (!word || leadingArticle(entry) || startsWithGenderWord(lang, entry)) return undefined;
  return lang === 'fr' && elidesBefore(lang, entry.trim()) ? "l'" : word;
}

/**
 * The plural gender word to show before a bare Entry (te, ci), from the Gender field's value as written, or undefined:
 * no such value, a language with none, or an Entry that already starts with a gender word of its own.
 */
export function pluralWord(lang: string, value: string, entry: string): string | undefined {
  const word = PLURAL_PREFIXES[lang]?.[value.trim().toLowerCase()];
  return word && !startsWithGenderWord(lang, entry) ? word : undefined;
}

/**
 * The word a verb is named with, by language: Norwegian's å (å huske). The Entry is the bare verb, and the card
 * shows this before it and the voice says it, as with a noun's article, so the word stays one a sentence or
 * a word list can be matched against. The MCP holds notes to the bare verb (omnilanguage.py,
 * entry-infinitive-marker) and says the same word in its recordings (articles.py, `VERB_MARKERS`).
 */
const VERB_MARKERS: Record<string, string> = { nb: 'å' };

/** The marker to show before a bare verb, or undefined: not a verb, a language with none, or an Entry that already starts with it. */
export function verbMarker(lang: string, partOfSpeech: string, entry: string): string | undefined {
  const word = VERB_MARKERS[lang];
  if (!word || partOfSpeech.trim().toLowerCase() !== 'verb' || entry.trim().toLowerCase().startsWith(`${word} `)) return undefined;
  return word;
}

/** A verb as it's written in the Entry: without the marker the card puts before it (å huske -> huske). Used when a word is added. */
export function bareVerb(lang: string, partOfSpeech: string, entry: string): string {
  const word = VERB_MARKERS[lang];
  const e = entry.trim();
  return word && partOfSpeech.trim().toLowerCase() === 'verb' && e.toLowerCase().startsWith(`${word} `) ? e.slice(word.length).trim() : entry;
}

/** An article and its word as they're written or said: l'amertume, but el blindaje. */
export const withArticle = (article: string, word: string): string => (/['’]$/.test(article) ? `${article}${word}` : `${article} ${word}`);

/** Whether the voice or a recording says the article with the word. */
export const articleIsSpoken = (lang: string): boolean => SPOKEN_ARTICLE.has(lang);

/**
 * A noun as it's written in the Entry once its Gender is known: without its article when that is the one the
 * Gender gives (der Tisch with m -> Tisch), and as it is when it isn't (el agua with f, l'homme), which is how
 * an exception is written. Used when a word is added, so new notes match the ones already backfilled.
 */
export function bareNoun(lang: string, gender: Gender | undefined, entry: string): string {
  const split = leadingArticle(entry);
  if (!split) return entry;
  const rest = split.rest.trim();
  return genderArticle(lang, gender, rest)?.toLowerCase() === split.article.toLowerCase().replace('’', "'") ? rest : entry;
}

/**
 * What the voice or a recording says for a note's word: the article (or Polish's plural word, te spodnie) and the
 * Entry where it is spoken, a verb with its marker (å huske), else the Entry. It is what `renderOmnilanguage`
 * shows before the word, so a card's audio never says less than its text.
 */
export function spokenEntry(lang: string, genderField: string, partOfSpeech: string, entry: string): string {
  const article = genderArticle(lang, genderOf(genderField), entry) ?? pluralWord(lang, genderField, entry);
  if (article && articleIsSpoken(lang)) return withArticle(article, entry);
  const marker = verbMarker(lang, partOfSpeech, entry);
  return marker ? `${marker} ${entry}` : entry;
}
