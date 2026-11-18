import { useCallback, useMemo } from 'react';
import { deckTint, deckTintSlots } from '../core/deckBadge';
import { useApp } from './AppContext';
import { useTheme } from './theme';

/**
 * A deck's tint (`deckTintSlots`: siblings never share one), the same on the deck list and in
 * Review. A deck the list doesn't have (yet) takes the tint its name prefers.
 */
export function useDeckTint(): (deck: string) => string {
  const c = useTheme();
  const { decks } = useApp();
  const slots = useMemo(() => deckTintSlots(decks.map((d) => d.deck), c.deckTints.length), [decks, c.deckTints.length]);
  return useCallback((deck: string) => c.deckTints[slots.get(deck) ?? deckTint(deck, c.deckTints.length)], [slots, c.deckTints]);
}
