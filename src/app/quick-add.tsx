import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { speechLangFor } from '../core/cards';
import { languageKey, languageName } from '../core/voices';
import { LANGUAGES } from '../reader/languages';
import { quickAddDecks } from '../reader/noteQueue';
import { useApp } from '../ui/AppContext';
import { Loading, Screen } from '../ui/kit';
import { leaveScreen } from '../ui/leaveScreen';
import { QuickAdd, type QuickAddDeck } from '../ui/QuickAdd';
import { lastQuickAddDeck } from '../ui/lastDeck';
import { DECKS_PATH } from '../ui/tabPaths';
import { useNoteQueue } from '../ui/useNoteQueue';
import { useQuickAddNotes } from '../ui/useQuickAddNotes';

/**
 * Quick add, as a sheet from the Decks header's +, a deck's long-press menu (`deck`) or the Home Screen
 * quick action. A Read & Listen language's deck, while it's on, sends words to the note queue for
 * Claude to fill in; every other deck saves each word and its meaning as a note.
 */
export default function QuickAddRoute() {
  const router = useRouter();
  const { deck: asked } = useLocalSearchParams<{ deck?: string }>();
  const { reader } = useApp();
  const queue = useNoteQueue(reader.api);
  const notes = useQuickAddNotes();
  const last = lastQuickAddDeck.use();
  const collection = notes.collection;

  const decks = useMemo<QuickAddDeck[]>(() => {
    if (!collection) return [];
    const claude = reader.api ? quickAddDecks(reader.settings?.decks, collection.decks) : [];
    return collection.decks.map((deck) => {
      const language = claude.find((d) => d.deck === deck)?.language;
      if (language) return { deck, filled: true, speechTag: LANGUAGES[language].speech, languageName: LANGUAGES[language].name };
      const speechTag = speechLangFor({ id: '', deck, model: '', fields: {}, tags: [] });
      return { deck, filled: false, speechTag, languageName: speechTag ? languageName(languageKey(speechTag)) : undefined };
    });
  }, [collection, reader.api, reader.settings?.decks]);

  // Read & Listen's settings say which decks Claude fills in, so wait for them while it's on.
  const loading = !collection || last === undefined || (reader.api && !reader.settings);
  if (notes.problem || loading || !decks.length) {
    return (
      <Screen title="Quick add" largeTitle={false}>
        <Loading error={notes.problem ?? (!loading && !decks.length ? 'There are no decks to add to yet. Make one on the deck list first.' : null)} onRetry={notes.problem ? notes.retry : undefined} />
      </Screen>
    );
  }
  const has = (d: string | null | undefined) => (d && decks.some((x) => x.deck === d) ? d : undefined);
  const initial = has(asked) ?? has(last) ?? decks.find((d) => d.filled)?.deck ?? decks[0].deck;
  const languageOf = (deck: string) => quickAddDecks(reader.settings?.decks, [deck])[0]?.language;
  const api = reader.api;

  return (
    <QuickAdd
      decks={decks}
      initial={initial}
      collection={collection}
      onQueue={async (deck, words) => {
        const language = languageOf(deck);
        return language ? queue.add(language, deck, words.map((w) => ({ entry: w.entry, meaning: w.meaning }))) : undefined;
      }}
      onSave={notes.save}
      onLookUp={api ? async (deck, meaning) => {
        const language = languageOf(deck);
        return language ? api.lookUpWords(language, meaning) : [];
      } : undefined}
      onDeckChosen={lastQuickAddDeck.save}
      onDone={() => leaveScreen(router, DECKS_PATH)}
    />
  );
}
