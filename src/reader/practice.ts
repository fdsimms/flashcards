// "Read a text with these words": after studying a language's deck, the words just studied become
// the next text's practice words (docs/read-and-listen/architecture.md, Practice words). Pure, so
// it's tested; Review shows the button and its route opens Read & Listen with the words.
import { htmlToText } from '../core/html';
import type { Note } from '../core/types';
import type { Language } from './api';

const under = (deck: string, parent: string) => deck === parent || deck.startsWith(`${parent}::`);

/**
 * The Read & Listen language whose deck `deck` is, or is inside. A deck above them (one holding
 * several languages) is the language whose deck is the only one under it, and otherwise none.
 */
export function languageOfDeck(deck: string, decks: Partial<Record<Language, string>>): Language | null {
  const entries = Object.entries(decks) as [Language, string][];
  const inside = entries.find(([, d]) => under(deck, d));
  if (inside) return inside[0];
  const below = entries.filter(([, d]) => under(d, deck));
  return below.length === 1 ? below[0][0] : null;
}

/**
 * The words answered in a session, from cards in `languageDeck` or under it: each note's Entry
 * as plain text, once each, in the order first answered. Notes without an Entry field (another
 * note type) are left out.
 */
export function practiceWords(answered: { noteId: string; deck: string }[], notes: Map<string, Note>, languageDeck: string): string[] {
  const words: string[] = [];
  for (const a of answered) {
    if (!under(a.deck, languageDeck)) continue;
    const entry = notes.get(a.noteId)?.fields.Entry;
    const word = entry ? htmlToText(entry).replace(/\s+/g, ' ').trim() : '';
    if (word && !words.includes(word)) words.push(word);
  }
  return words;
}
