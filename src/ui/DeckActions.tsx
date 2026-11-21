import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { ActionSheetIOS, Alert } from 'react-native';
import { createDeck, deckDeletionPreview, DeckRefused, deleteDeck, moveDeck, renameDeck } from '../anki/deckService';
import { refreshFromKeptCollection } from '../anki/transfer';
import { deckDeletionWarning } from '../core/deckNames';
import { deckSuspension, deckSuspensionWarning } from '../core/deckSuspension';
import { setCardStates } from '../anki/noteService';
import { reviewWrites } from '../core/writeQueue';
import type { DeckMove } from '../core/deckOrder';
import { isInDeck } from '../core/deckTree';
import { useApp } from './AppContext';
import type { DeckAction } from './DeckList';
import { shareDeckNotes } from './exportDeck';
import { haptic } from './haptics';
import { failureText } from '../core/failure';

/**
 * Making, renaming, moving and deleting decks from the deck list (src/anki/deckService.ts): "New
 * deck" in the toolbar, a menu on each deck's row (Suspend all and Unsuspend all included), and dragging a row (DeckDrag.tsx). Names are asked for in the system's text prompt;
 * a name that's refused (taken, empty, inside the deck itself) asks again, saying why.
 */
export function useDeckActions(onOptions: (deck: string) => void) {
  const { repo, decks, refresh, openNoteEditor, collapse } = useApp();
  const router = useRouter();
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
      else Alert.alert(failed, failureText(e, { next: 'Try again.' }));
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
        onPress: (value?: string) => run("Couldn't create the deck", () => createDeck(repo, value ?? '', fromAnki), (p) => create(p, value ?? '')),
      },
    ], 'plain-text', typed);
  }, [repo, run, fromAnki]);

  const rename = useCallback((deck: string, problem?: string, typed = deck) => {
    Alert.prompt(`Rename "${deck}"`, problem ?? 'Its subdecks move with it. To put it inside another deck, use "::".', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rename', isPreferred: true,
        onPress: (value?: string) => run("Couldn't rename the deck", () => renameDeck(repo, deck, value ?? '', fromAnki), (p) => rename(deck, p, value ?? '')),
      },
    ], 'plain-text', typed);
  }, [repo, run, fromAnki]);

  const remove = useCallback(async (deck: string) => {
    let preview;
    try {
      preview = await deckDeletionPreview(repo, deck);
    } catch (e) {
      Alert.alert("Couldn't delete the deck", failureText(e, { next: 'Try again.' }));
      return;
    }
    const subdecks = decks.filter((r) => r.deck !== deck && isInDeck(r.deck, deck)).length;
    Alert.alert(`Delete "${deck}"?`, deckDeletionWarning(preview, subdecks), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run("Couldn't delete the deck", () => deleteDeck(repo, deck, fromAnki)) },
    ]);
  }, [repo, decks, run, fromAnki]);

  /** Suspends or unsuspends every card of a deck and its subdecks, after saying how many and which subdecks. */
  const setSuspended = useCallback(async (deck: string, suspend: boolean) => {
    const verb = suspend ? 'Suspend' : 'Unsuspend';
    let plan;
    let dayStartsAtHour;
    try {
      // After the answers Review has shown but not yet written (src/core/writeQueue.ts).
      await reviewWrites.idle();
      const [notes, cards, settings] = await Promise.all([repo.listNotes(), repo.listCards(), repo.collectionSettings()]);
      plan = deckSuspension(notes, cards, deck, suspend);
      dayStartsAtHour = settings.dayStartsAtHour;
    } catch (e) {
      Alert.alert(`Couldn't ${verb.toLowerCase()} the cards`, failureText(e, { next: 'Try again.' }));
      return;
    }
    if (!plan.cards.length) {
      Alert.alert(suspend ? 'Nothing to suspend' : 'Nothing to unsuspend', `Every card in "${deck}" and its subdecks is already ${suspend ? 'suspended' : 'unsuspended'}.`);
      return;
    }
    const targets = plan.cards;
    Alert.alert(`${verb} all cards in "${deck}"?`, deckSuspensionWarning(plan, suspend), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: verb, style: suspend ? 'destructive' : 'default',
        onPress: () => run(`Couldn't ${verb.toLowerCase()} the cards`, async () => {
          const { ankiError } = await setCardStates(repo, targets, (s) => ({ ...s, suspended: suspend }), new Date(), dayStartsAtHour);
          if (ankiError) Alert.alert("Couldn't save this change for Anki", failureText(ankiError, { next: "It's made in Franki, but it won't reach Anki." }));
        }),
      },
    ]);
  }, [repo, run]);

  /** A deck dragged to a new place. Dropped into a collapsed deck, that deck opens to show it there. */
  const move = useCallback((m: DeckMove) => {
    run("Couldn't move the deck", async () => {
      await moveDeck(repo, m, fromAnki);
      if (m.parent !== null && collapse.collapsed.has(m.parent)) collapse.toggle(m.parent);
    });
  }, [repo, run, fromAnki, collapse]);

  /** One thing done to a deck, from the long-press menu or the ⋯ sheet. */
  const act = useCallback((deck: string, action: DeckAction) => {
    if (action === 'quick') router.push({ pathname: '/quick-add', params: { deck } });
    // The note editor starts in this deck, which may have no notes yet (one just made).
    if (action === 'note') openNoteEditor({ deck }, (result) => { if (result) refresh(); });
    if (action === 'rename') rename(deck);
    if (action === 'options') onOptions(deck);
    if (action === 'export') shareDeckNotes(repo, deck).catch((e) => Alert.alert("Couldn't export the notes", failureText(e, { next: 'Try again.' })));
    if (action === 'suspend') setSuspended(deck, true);
    if (action === 'unsuspend') setSuspended(deck, false);
    if (action === 'delete') remove(deck);
  }, [router, openNoteEditor, refresh, rename, onOptions, remove, setSuspended, repo]);

  /** The sheet the ⋯ button on a deck's row opens: the same choices as the long-press menu. */
  const menu = useCallback((deck: string) => {
    haptic.tap();
    const options = ['Quick add', 'Add note', 'Rename', 'Deck options', 'Export notes', 'Suspend all', 'Unsuspend all', 'Delete', 'Cancel'];
    const actions: DeckAction[] = ['quick', 'note', 'rename', 'options', 'export', 'suspend', 'unsuspend', 'delete'];
    ActionSheetIOS.showActionSheetWithOptions({ title: deck, options, cancelButtonIndex: 8, destructiveButtonIndex: 7 }, (i) => {
      if (i < actions.length) act(deck, actions[i]);
    });
  }, [act]);

  return { create: () => create(), menu, act, move };
}
