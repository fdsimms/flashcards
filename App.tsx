import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, NEW_PER_DAY, REVIEWS_PER_DAY } from './src/core/config';
import { deckLimits, deckRows, groupByDeck, type DeckRow } from './src/core/deckTree';
import { paramsForDeck } from './src/core/scheduler';
import { backupStatus } from './src/db/backup';
import type { Repo } from './src/db/repo';
import { openRepo, type BackupStore } from './src/db/sqliteRepo';
import { Backup } from './src/ui/Backup';
import { DeckList } from './src/ui/DeckList';
import { Import } from './src/ui/Import';
import { Review } from './src/ui/Review';

type Screen = { name: 'decks' } | { name: 'import' } | { name: 'backup' } | { name: 'review'; deck: string };

export default function App() {
  const [repo, setRepo] = useState<(Repo & BackupStore) | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'decks' });
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [backup, setBackup] = useState<{ text: string; overdue: boolean }>();

  useEffect(() => { openRepo().then(setRepo); }, []);

  const refresh = useCallback(async () => {
    if (!repo) return;
    const now = new Date();
    const [notes, cards, allParams, studiedByDeck, lastBackup] = await Promise.all([
      repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.studiedToday(now, DAY_STARTS_AT_HOUR), repo.lastBackupAt(),
    ]);
    const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
    setDecks(deckRows({
      cardsByDeck: groupByDeck(cards, deckOf),
      limitsFor: (d) => deckLimits(paramsForDeck(d, allParams), { newPerDay: NEW_PER_DAY, reviewsPerDay: REVIEWS_PER_DAY }),
      studiedByDeck,
      dayStartsAtHour: DAY_STARTS_AT_HOUR,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      now,
    }));
    setBackup(backupStatus(lastBackup, now, cards.length > 0));
  }, [repo]);

  useEffect(() => { if (screen.name === 'decks') refresh(); }, [screen, refresh]);

  if (!repo) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;

  return (
    <>
      {screen.name === 'decks' && (
        <DeckList decks={decks} backup={backup} onOpen={(deck) => setScreen({ name: 'review', deck })} onImport={() => setScreen({ name: 'import' })}
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
