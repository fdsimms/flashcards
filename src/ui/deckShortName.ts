import { leadingEmoji } from '../core/deckBadge';

/** A deck's own name without the path or its emoji: "Español" for "👅 Languages::🌮 Español". */
export function deckShortName(deck: string): string {
  return leadingEmoji(deck.split('::').pop() ?? deck).rest;
}
