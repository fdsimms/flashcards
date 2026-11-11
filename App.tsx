import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { summarizeDecks, type DeckSummary, type Repo } from './src/db/repo';
import { openRepo } from './src/db/sqliteRepo';
import { DeckList } from './src/ui/DeckList';
import { Import } from './src/ui/Import';
import { Review } from './src/ui/Review';

type Screen = { name: 'decks' } | { name: 'import' } | { name: 'review'; deck: string };

export default function App() {
  const [repo, setRepo] = useState<Repo | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'decks' });
  const [decks, setDecks] = useState<DeckSummary[]>([]);

  useEffect(() => { openRepo().then(setRepo); }, []);

  const refresh = useCallback(async () => {
    if (!repo) return;
    const [notes, cards] = await Promise.all([repo.listNotes(), repo.listCards()]);
    setDecks(summarizeDecks(notes, cards, 20));
  }, [repo]);

  useEffect(() => { if (screen.name === 'decks') refresh(); }, [screen, refresh]);

  if (!repo) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  return (
    <>
      {screen.name === 'decks' && (
        <DeckList decks={decks} onOpen={(deck) => setScreen({ name: 'review', deck })} onImport={() => setScreen({ name: 'import' })} />
      )}
      {screen.name === 'import' && <Import repo={repo} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'review' && <Review repo={repo} deck={screen.deck} onDone={() => setScreen({ name: 'decks' })} />}
      <StatusBar style="auto" />
    </>
  );
}
