import { cardHomeDeck, isInDeck } from './deckTree';
import type { Card, Note } from './types';

/** How many subdeck names the confirmation lists before counting the rest. */
export const SUSPENSION_NAMES_SHOWN = 8;

export interface DeckSuspension {
  /** The cards that change: studied cards of the deck and its subdecks not already in the wanted state. */
  cards: Card[];
  /** The subdecks those cards are in (not the deck itself), by name, with how many of them each has. */
  subdecks: { deck: string; count: number }[];
}

/**
 * Suspending (or unsuspending) every card of `deck` and the decks under it. A card is in a deck by
 * its own deck (`cardHomeDeck`), as deleting a deck counts it, so one a filtered deck is holding
 * still goes with its own deck. Retired cards are never offered for study, so they are left alone.
 */
export function deckSuspension(notes: Note[], cards: Card[], deck: string, suspend: boolean): DeckSuspension {
  const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
  const changing = cards.filter((c) => !c.retired && c.suspended !== suspend && isInDeck(cardHomeDeck(c, deckOf.get(c.noteId) ?? 'Imported'), deck));
  const counts = new Map<string, number>();
  for (const c of changing) {
    const home = cardHomeDeck(c, deckOf.get(c.noteId) ?? 'Imported');
    if (home !== deck) counts.set(home, (counts.get(home) ?? 0) + 1);
  }
  return {
    cards: changing,
    subdecks: [...counts].map(([d, count]) => ({ deck: d, count })).sort((a, b) => a.deck.localeCompare(b.deck)),
  };
}

/**
 * What the deck list asks before suspending or unsuspending a deck's cards: how many, and the
 * subdecks they're in by name (the first few, then how many more), since the deck's own name
 * doesn't say what's inside it.
 */
export function deckSuspensionWarning(p: DeckSuspension, suspend: boolean): string {
  const n = (count: number, one: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : `${one}s`}`;
  const what = suspend ? 'stop showing up in reviews until you unsuspend them' : 'show up in reviews again';
  const lines = [`${n(p.cards.length, 'card')} will ${what}.`];
  if (p.subdecks.length) {
    const shown = p.subdecks.slice(0, SUSPENSION_NAMES_SHOWN).map((s) => `${s.deck} (${s.count.toLocaleString('en-US')})`);
    const more = p.subdecks.length - shown.length;
    lines.push('', `In ${n(p.subdecks.length, 'subdeck')}:`, ...shown, ...(more > 0 ? [`and ${n(more, 'more subdeck')}`] : []));
  }
  return lines.join('\n');
}
