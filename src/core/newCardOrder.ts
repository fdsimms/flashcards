import { paramsForDeck } from './scheduler';
import type { DeckParams } from './types';

/**
 * Where a session puts new cards among reviews: the Anki preset's "New/review order", with Anki's
 * enum values (`StudyOrder.newMix`). A deck is opened with its own preset's order (`treeQueue`
 * reads the opened deck's), never a subdeck's.
 */
export const NEW_CARD_ORDERS = [
  { mix: 0, label: 'Mixed in with reviews', hint: 'New cards are spread evenly through the session.' },
  { mix: 1, label: 'After reviews', hint: 'Every review first, then the new cards.' },
  { mix: 2, label: 'Before reviews', hint: 'New cards first, then the reviews.' },
] as const;

export interface NewCardOrder {
  /** The Anki preset the deck uses. */
  presetId: number;
  mix: number;
  /** The other decks that use the same preset, which a change applies to as well. */
  sharedWith: string[];
}

/** The order a deck is studied with, and who shares it. Undefined for a deck with no Anki preset (a filtered deck, or one Anki doesn't have). */
export function newCardOrderOf(deck: string, params: Map<string, DeckParams>): NewCardOrder | undefined {
  const own = paramsForDeck(deck, params);
  if (!own || own.filtered || own.presetId === undefined) return undefined;
  const ownName = [...params].find(([, p]) => p === own)?.[0];
  const sharedWith = [...params].filter(([name, p]) => name !== ownName && !p.filtered && p.presetId === own.presetId).map(([name]) => name);
  return { presetId: own.presetId, mix: own.order?.newMix ?? 0, sharedWith };
}

/** What a change to the order says it also changes, for the line under the options. */
export function newCardOrderNote(sharedWith: number): string {
  const others = sharedWith === 0 ? '' : `This is an Anki options preset that ${sharedWith === 1 ? '1 other deck uses' : `${sharedWith} other decks use`} too, so the change applies to ${sharedWith === 1 ? 'it' : 'them'} as well. `;
  return `${others}It syncs to your other devices.`;
}
