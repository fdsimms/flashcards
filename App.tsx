import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DAY_STARTS_AT_HOUR, STUDY_DEFAULTS } from './src/core/config';
import { queueOptionsFor } from './src/core/queue';
import { paramsForDeck } from './src/core/scheduler';
import { summarizeDecks, type DeckSummary, type Repo } from './src/db/repo';
import { openRepo, type BackupStore } from './src/db/sqliteRepo';
import { Backup } from './src/ui/Backup';
import { DeckList } from './src/ui/DeckList';
import { Import } from './src/ui/Import';
import { Review } from './src/ui/Review';

type Screen = { name: 'decks' } | { name: 'import' } | { name: 'backup' } | { name: 'review'; deck: string };

export default function App() {
  const [repo, setRepo] = useState<(Repo & BackupStore) | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'decks' });
  const [decks, setDecks] = useState<DeckSummary[]>([]);

  useEffect(() => { openRepo().then(setRepo); }, []);

  const refresh = useCallback(async () => {
    if (!repo) return;
    const now = new Date();
    const [notes, cards, allParams] = await Promise.all([repo.listNotes(), repo.listCards(), repo.listDeckParams()]);
    const deckNames = [...new Set(notes.map((n) => n.deck))];
    const studied = await Promise.all(deckNames.map((d) => repo.studiedToday(d, now, DAY_STARTS_AT_HOUR)));
    const studiedByDeck = new Map(deckNames.map((d, i) => [d, studied[i]]));
    setDecks(summarizeDecks(notes, cards, (deck) => queueOptionsFor(
      paramsForDeck(deck, allParams),
      studiedByDeck.get(deck) ?? { introduced: 0, reviewed: 0 },
      { ...STUDY_DEFAULTS, now },
    )));
  }, [repo]);

  useEffect(() => { if (screen.name === 'decks') refresh(); }, [screen, refresh]);

  if (!repo) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  return (
    <>
      {screen.name === 'decks' && (
        <DeckList decks={decks} onOpen={(deck) => setScreen({ name: 'review', deck })} onImport={() => setScreen({ name: 'import' })}
          onBackup={() => setScreen({ name: 'backup' })}
        />
      )}
      {screen.name === 'import' && <Import repo={repo} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'backup' && <Backup store={repo} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'review' && <Review repo={repo} deck={screen.deck} onDone={() => setScreen({ name: 'decks' })} />}
      <StatusBar style="auto" />
    </>
  );
}
