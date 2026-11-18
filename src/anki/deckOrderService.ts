import { DEFAULT_ORDER } from '../core/order';
import { Refusal } from '../core/failure';
import { newCardOrderOf } from '../core/newCardOrder';
import type { DeckParams } from '../core/types';
import type { NoteStore } from './noteService';
import { setAnkiNewMix } from './presetWrites';

/** Why the order can't be changed, with what to do, to show as it is. */
export class DeckOrderRefused extends Refusal {}

/**
 * Sets where new cards go among reviews for the preset a deck uses (Deck options): in the kept
 * Anki collection, so sync carries it to every device, and in Franki's copy of each deck using the
 * preset, so the next session and the deck list follow it at once.
 */
export async function setNewCardOrder(store: NoteStore, deck: string, mix: number, now: Date = new Date()): Promise<void> {
  const params = await store.listDeckParams();
  const use = newCardOrderOf(deck, params);
  if (!use) throw new DeckOrderRefused("This deck has no Anki options to change. Its cards are studied with the options of the decks they came from.");
  if (!(await store.keptCollection())) throw new DeckOrderRefused('This needs your Anki collection in Franki. Set up Anki first, from the Decks screen.');
  const found = await store.lockAnki(() => store.withSyncConnection((db) => setAnkiNewMix(db, use.presetId, mix, now)));
  if (!found) throw new DeckOrderRefused("Anki doesn't have this deck's options anymore. Sync, then try again.");
  const changed = new Map<string, DeckParams>();
  for (const [name, p] of params) {
    if (!p.filtered && p.presetId === use.presetId) changed.set(name, { ...p, order: { ...(p.order ?? DEFAULT_ORDER), newMix: mix } });
  }
  await store.saveDeckParams(changed);
}
