import { useCallback } from 'react';
import { Alert } from 'react-native';
import { saveNote } from '../anki/noteService';
import { failureText } from '../core/failure';
import type { Note } from '../core/types';
import type { AspectPair, GlossLanguage } from '../reader/api';
import type { Heard } from '../reader/heardLine';
import { hasAspectPairs, hasAspectPartner, minedNote, pairFollowUp, type MinedNote, type PairFollowUp, type Pronunciation } from '../reader/mining';
import { useApp } from './AppContext';
import { connection } from './connection';
import { haptic } from './haptics';
import { useLineClip } from './useLineClip';
import { useNoteQueue } from './useNoteQueue';

/** What to add to the deck: a word from a text, the marked words, the vocabulary check or a card's example sentence. */
export type AddWord = {
  word: string;
  meaning: string | null;
  deck: string;
  /** The word's own language, which decides whether a verb's aspect pair is looked up (Russian and Polish). */
  language?: GlossLanguage;
  pronunciation?: Pronunciation;
  /** Where it was heard, for a word from a text (src/reader/heardLine.ts): the note keeps the line in Source and its clip in SourceAudio. */
  heard?: Heard | null;
};

/**
 * "Add to deck", for every screen that offers it. A word goes to the note queue, where Claude writes the example
 * sentence, its translation, the romanization and the register, and it opens in the note editor from "ready to review"
 * (saving there is the approval). With no Read & Listen language, or when the server can't fill it in (no Claude key),
 * the editor opens at once on the word and its meaning. A Russian or Polish verb first has its aspect partner looked
 * up, and opens in the editor with it and the aspect tag, since the queue doesn't write those. After the verb is saved, offers to add the partner as its own note, or to link a partner already in the
 * deck back (`pairFollowUp`), so a pair is two notes linked both ways whichever half was added first.
 * Resolves to whether the word was handled: queued, or its note saved.
 */
export function useAddMinedWord(): (add: AddWord) => Promise<boolean> {
  const { repo, reader, openNoteEditor } = useApp();
  const api = reader.api;
  const queue = useNoteQueue(api);
  const clip = useLineClip();

  const edit = useCallback((target: MinedNote) => new Promise<Note | null>((resolve) => {
    openNoteEditor(target, (result) => resolve(result && 'saved' in result ? result.saved : null));
  }), [openNoteEditor]);

  const link = useCallback(async (offer: Extract<PairFollowUp, { kind: 'link' }>) => {
    try {
      await saveNote(repo, { id: offer.note.id, deck: offer.note.deck, model: offer.note.model, fields: offer.fields, tags: offer.tags });
    } catch (e) {
      Alert.alert(`Couldn't link ${offer.partner} to ${offer.word}`, failureText(e, { next: 'Try again from the note.' }));
    }
  }, [repo]);

  const offer = useCallback(async (saved: Note, pair: AspectPair) => {
    let follow: PairFollowUp | null;
    try {
      follow = pairFollowUp(saved, await repo.listNotes(), pair.partner_meaning);
    } catch {
      return; // Only an offer: the verb itself is saved.
    }
    if (!follow) return;
    const word = saved.fields.Entry;
    // The editor is still closing when it reports back, and iOS doesn't show an alert over a screen that's leaving.
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (follow.kind === 'add') {
      const { target, partner, aspect } = follow;
      Alert.alert(
        'Add the other half of the pair?',
        `${partner}${aspect ? ` (${aspect})` : ''} is the aspect pair of ${word}. It opens as a new note to check before saving.`,
        [{ text: 'Not now', style: 'cancel' }, { text: `Add ${partner}`, onPress: () => { void edit(target); } }],
      );
    } else {
      const linkOffer = follow;
      Alert.alert(
        `Link ${linkOffer.partner} to ${word}?`,
        `${linkOffer.partner} is in your deck but doesn't list ${word} as its aspect pair.`,
        [{ text: 'Not now', style: 'cancel' }, { text: 'Link them', onPress: () => { void link(linkOffer); } }],
      );
    }
  }, [repo, edit, link]);

  return useCallback(async ({ word, meaning, deck, language, pronunciation, heard }: AddWord) => {
    let pair: AspectPair | null = null;
    // A phrase has no aspect. A failed lookup, or an answer with no partner (not a verb), goes to the queue like any other word.
    // Offline there's no lookup to wait on: the word is held for Claude below.
    if (api && language && !connection.cantReachHome() && hasAspectPairs(language) && !/\s/.test(word.trim())) {
      pair = await api.aspectPair(language, word).catch(() => null);
    }
    if (!hasAspectPartner(pair) && api && language) {
      try {
        const added = await queue.add(language, deck, [{ entry: word, meaning: meaning ?? '', ...(heard ? { heard } : {}) }]);
        haptic.success();
        if (added === 'held') Alert.alert(`Added ${word}`, `${connection.offline() ? "You're offline. Claude fills it in when you're back online" : "Couldn't reach your server. Claude fills it in once the server answers"}. Then it'll be ready to review on Today.`);
        else Alert.alert(`Added ${word} to your queue`, "Claude is writing an example sentence and translation. In a few minutes it will be ready to review on Today.");
        return true;
      } catch {
        // The server refused it (no Claude key): the editor still works by hand. Offline it was held instead.
      }
    }
    const saved = await edit(await clip.note(minedNote(word, meaning, deck, pronunciation, pair, language), heard));
    if (!saved) return false;
    clip.keep(saved, heard);
    if (hasAspectPartner(pair)) void offer(saved, pair);
    return true;
  }, [api, queue.add, edit, offer, clip]);
}
