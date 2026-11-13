import type { DeckRow } from '../core/deckTree';

/**
 * The shelf's suggestion to review first. A word due today and not reviewed yet is left out of new
 * texts (docs/read-and-listen/architecture.md), so while a language's deck has reviews due, the
 * shelf says how many and opens them. The count is the deck list's own row (`deckRows`), so the
 * card never says 12 and opens a deck with none.
 */
export interface ReviewFirst {
  /** The deck to open: the one the language's texts are written from. */
  deck: string;
  due: number;
  message: string;
  hint: string;
}

export function reviewFirst(deck: string | undefined, languageName: string, rows: readonly Pick<DeckRow, 'deck' | 'due'>[]): ReviewFirst | undefined {
  if (!deck) return undefined;
  const due = rows.find((r) => r.deck === deck)?.due ?? 0;
  if (due <= 0) return undefined;
  return {
    deck,
    due,
    message: `${due} ${languageName} ${due === 1 ? 'review' : 'reviews'} due`,
    hint: due === 1 ? 'Review it first, and new texts can use that word.' : 'Review them first, and new texts can use those words.',
  };
}
