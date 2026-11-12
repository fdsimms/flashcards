import { useCallback, useRef } from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import { createDeck, deckDeletionPreview, DeckRefused, deleteDeck, moveDeck, renameDeck } from '../anki/deckService';
import { refreshFromKeptCollection } from '../anki/transfer';
import { deckDeletionWarning } from '../core/deckNames';
import type { DeckMove } from '../core/deckOrder';
import { isInDeck } from '../core/deckTree';
import { useApp } from './AppContext';
import { haptic } from './haptics';

/**
 * Making, renaming, moving and deleting decks from the deck list (src/anki/deckService.ts): "New
 * deck" in the toolbar, a menu on each deck's row, and dragging a row (DeckDrag.tsx). Names are asked for in the system's text prompt;
 * a name that's refused (taken, empty, inside the deck itself) asks again, saying why.
 */
export function useDeckActions(onOptions: (deck: string) => void) {
  const { repo, decks, refresh, openNoteEditor, collapse } = useApp();
  // One change at a time: a second tap while one is being written does nothing.
  const busy = useRef(false);

  const run = useCallback(async (failed: string, work: () => Promise<unknown>, askAgain?: (problem: string) => void) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
      haptic.success();
    } catch (e) {
      if (e instanceof DeckRefused && askAgain) askAgain(e.message);
      else Alert.alert(failed, e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
      await refresh();
    }
  }, [refresh]);

  // After a change in Anki's collection, Franki reads its decks from it again.
  const fromAnki = useCallback(() => refreshFromKeptCollection(repo), [repo]);

  const create = useCallback((problem?: string, typed = '') => {
    Alert.prompt('New deck', problem ?? 'To put it inside another deck, use "::", as in Polski::Verbs.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create', isPreferred: true,
        onPress: (value?: string) => run("Couldn't create the deck.", () => createDeck(repo, value ?? '', fromAnki), (p) => create(p, value ?? '')),
      },
    ], 'plain-text', typed);
  }, [repo, run, fromAnki]);

  const rename = useCallback((deck: string, problem?: string, typed = deck) => {
    Alert.prompt(`Rename "${deck}"`, problem ?? 'Its subdecks move with it. To put it inside another deck, use "::".', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rename', isPreferred: true,
        onPress: (value?: string) => run("Couldn't rename the deck.", () => renameDeck(repo, deck, value ?? '', fromAnki), (p) => rename(deck, p, value ?? '')),
      },
    ], 'plain-text', typed);
  }, [repo, run, fromAnki]);

  const remove = useCallback(async (deck: string) => {
    let preview;
    try {
      preview = await deckDeletionPreview(repo, deck);
    } catch (e) {
      Alert.alert("Couldn't delete the deck.", e instanceof Error ? e.message : String(e));
      return;
    }
    const subdecks = decks.filter((r) => r.deck !== deck && isInDeck(r.deck, deck)).length;
    Alert.alert(`Delete "${deck}"?`, deckDeletionWarning(preview, subdecks), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run("Couldn't delete the deck.", () => deleteDeck(repo, deck, fromAnki)) },
    ]);
  }, [repo, decks, run, fromAnki]);

  /** A deck dragged to a new place. Dropped into a collapsed deck, that deck opens to show it there. */
  const move = useCallback((m: DeckMove) => {
    run("Couldn't move the deck.", async () => {
      await moveDeck(repo, m, fromAnki);
      if (m.parent !== null && collapse.collapsed.has(m.parent)) collapse.toggle(m.parent);
    });
  }, [repo, run, fromAnki, collapse]);

  /** The menu on a deck's row: add a note to it, rename it, its options, delete it. */
  const menu = useCallback((deck: string) => {
    haptic.tap();
    const options = ['Add note', 'Rename', 'Deck options', 'Delete', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: deck, options, cancelButtonIndex: 4, destructiveButtonIndex: 3 }, (i) => {
      // The note editor starts in this deck, which may have no notes yet (one just made).
      if (i === 0) openNoteEditor({ deck }, (result) => { if (result) refresh(); });
      if (i === 1) rename(deck);
      if (i === 2) onOptions(deck);
      if (i === 3) remove(deck);
    });
  }, [openNoteEditor, refresh, rename, onOptions, remove]);

  return { create: () => create(), menu, move };
}
