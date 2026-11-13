/**
 * What a tool's answer is made of: the words in the language, and for a language not written in
 * Latin letters, a romanization to show under them. Thai builds its phrases from words that each
 * carry their own (`phrase`); Russian and Greek transliterate the whole text. Japanese shows its
 * reading in hiragana there instead, which is what a learner of it reads.
 */

/** One word: as written, and romanized (Japanese: its reading in hiragana). */
export type Word = readonly [text: string, roman: string];

export interface Phrase {
  text: string;
  /** Only for a language not written in Latin letters: a romanization, or Japanese's reading in kana. */
  roman?: string;
  /** When it's said this way, if that needs saying ("the older count from 6 a.m."). */
  note?: string;
}

/** Words joined into a phrase: `glue` between the written words ('' for Thai), spaces between romanized ones. */
export function phrase(words: readonly Word[], glue: string, note?: string): Phrase {
  return {
    text: words.map((w) => w[0]).join(glue),
    roman: words.map((w) => w[1]).join(' '),
    ...(note ? { note } : {}),
  };
}

/** Phrases with any repeat of an earlier one's text left out, first kept. */
export function distinct(phrases: Phrase[]): Phrase[] {
  const seen = new Set<string>();
  return phrases.filter((p) => !seen.has(p.text) && !!seen.add(p.text));
}
