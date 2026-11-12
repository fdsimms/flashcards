import { isBuried } from './queue';
import type { Card } from './types';

/**
 * What the review screen's menu sets on a card, as Anki has it: suspended (out of study until
 * unsuspended), buried by hand (out until the next study day), and a flag. The kept collection
 * takes the same state as Anki writes it (writeback.ts `cardStateParams`).
 */
export interface CardState {
  suspended: boolean;
  buried: boolean;
  /** 0 none, 1 red, 2 orange, 3 green, 4 blue, 5 pink, 6 turquoise, 7 purple. */
  flag: number;
}

/** Anki's flag names, by flag number (index 0 is no flag). */
export const FLAG_NAMES = ['None', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'] as const;

export function cardStateOf(card: Card, now: Date, dayStartsAtHour: number): CardState {
  return { suspended: card.suspended, buried: isBuried(card, now, dayStartsAtHour), flag: card.flag ?? 0 };
}

/** The card with `state` applied, as Franki keeps it: a bury is held until the next study day (`isBuried`). */
export function withCardState(card: Card, state: CardState, now: Date): Card {
  return {
    ...card,
    suspended: state.suspended,
    buriedAt: state.buried ? now.toISOString() : undefined,
    flag: state.flag || undefined,
    // The kept collection stamps the card's mod, which seeds Anki's review order.
    ankiMod: card.ankiId ? Math.floor(now.getTime() / 1000) : card.ankiMod,
  };
}

/** The cards Anki's "Bury note" buries: every card of the note that's still studied. */
export function noteCards(card: Card, cards: Card[]): Card[] {
  return cards.filter((c) => c.noteId === card.noteId && !c.retired && !c.suspended);
}
