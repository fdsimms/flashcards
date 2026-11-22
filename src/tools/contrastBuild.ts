import type { ContrastSet, ContrastWord } from './contrasts';

/**
 * A Which word fits set for a language written with spaces between words (contrasts.ts): its words,
 * then each sentence as [text, the index of the word that fits, its English, and the form the gap takes
 * when it isn't the word itself (gefragt for fragen)]. The text has `_` for the gap, punctuation right
 * after it written on (`_,`). Thai builds its own (thai/contrasts.ts), with a romanization per word.
 * Its own file, with types only from contrasts.ts, so a language's sets can use it without an import cycle.
 */
export function plainSet(id: string, words: ContrastWord[], sentences: [text: string, answer: number, english: string, form?: string][]): ContrastSet {
  return {
    id,
    words,
    sentences: sentences.map(([text, answer, english, form]) => ({ tokens: text.split(' ').filter(Boolean), answer, english, ...(form ? { form } : {}) })),
  };
}
