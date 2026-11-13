// Adding a marked word, a phrase selected in the reader or a word from the vocabulary check to the deck ("mining"). Each one is a new note made in Franki's note editor,
// where saving it is the approval step (brief, design principle 13). There is no daily cap: how many new cards come up
// is the deck's own new-cards-per-day limit. Pure, so it's tested.

/** The new note a marked word or a selected phrase starts as, for the note editor: it and its meaning, in the language's deck. */
export function minedNote(word: string, gloss: string | null, deck: string): { deck: string; model: string; fields: Record<string, string> } {
  return { deck, model: 'Omnilanguage', fields: { Entry: word, Meaning: gloss ?? '' } };
}
