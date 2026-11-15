import type { Word } from './api';

/** A word's IPA and where it's from, as the server sends them (both absent from a server older than IPA). */
export type Pronunciation = Partial<Pick<Word, 'ipa' | 'ipa_source'>>;

// Adding a marked word, a phrase selected in the reader or a word from the vocabulary check to the deck ("mining"). Each one is a new note made in Franki's note editor,
// where saving it is the approval step (brief, design principle 13). There is no daily cap: how many new cards come up
// is the deck's own new-cards-per-day limit. Pure, so it's tested.

/**
 * The new note a marked word or a selected phrase starts as, for the note editor: it and its meaning, in the language's deck.
 * With the word's IPA, the Pronunciation field starts as it, to check before saving. The editor leaves out a field the note
 * type doesn't have, so a collection with no Pronunciation field simply doesn't show it.
 */
export function minedNote(
  word: string,
  gloss: string | null,
  deck: string,
  pronunciation?: Pronunciation,
): { deck: string; model: string; fields: Record<string, string>; fieldNotes?: Record<string, string> } {
  const ipa = pronunciation?.ipa;
  return {
    deck,
    model: 'Omnilanguage',
    fields: { Entry: word, Meaning: gloss ?? '', ...(ipa ? { Pronunciation: ipa } : {}) },
    // IPA written by AI isn't checked against anything, so the editor says so under the field.
    ...(ipa && pronunciation?.ipa_source === 'ai' ? { fieldNotes: { Pronunciation: 'Written by AI. Check it before saving.' } } : {}),
  };
}
