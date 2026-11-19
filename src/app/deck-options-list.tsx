import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useApp } from '../ui/AppContext';
import { DeckOptionsList } from '../ui/DeckOptionsList';

/** Every deck's options, from Settings and the Decks and cards settings page. */
export default function DeckOptionsListRoute() {
  const router = useRouter();
  const { decks, refresh } = useApp();
  // `decks` starts empty until the first load finishes, which is not the same as having no decks.
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => { refresh().finally(() => setLoaded(true)); }, [refresh]));
  return <DeckOptionsList decks={decks} loaded={loaded} onOpen={(deck) => router.push({ pathname: '/deck-options', params: { deck } })} />;
}
