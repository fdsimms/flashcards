import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, NEW_PER_DAY, REVIEWS_PER_DAY } from './src/core/config';
import { deckLimits, deckRows, groupByDeck, type DeckRow } from './src/core/deckTree';
import { paramsForDeck } from './src/core/scheduler';
import { backupStatus } from './src/db/backup';
import type { Repo } from './src/db/repo';
import type { AnkiLink } from './src/db/ankiLink';
import { openRepo, type BackupStore } from './src/db/sqliteRepo';
import { Backup } from './src/ui/Backup';
import { DeckOptions } from './src/ui/DeckOptions';
import { DeckList } from './src/ui/DeckList';
import { AnkiTransfer } from './src/ui/AnkiTransfer';
import { Review } from './src/ui/Review';
import { useTheme } from './src/ui/theme';

type Screen =
  | { name: 'decks' } | { name: 'anki' } | { name: 'backup' }
  | { name: 'review'; deck: string } | { name: 'deckOptions'; deck: string };

export default function App() {
  const c = useTheme();
  const [repo, setRepo] = useState<(Repo & BackupStore & AnkiLink) | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'decks' });
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [backup, setBackup] = useState<{ text: string; overdue: boolean }>();
  const [ankiUnsent, setAnkiUnsent] = useState(0);

  useEffect(() => { openRepo().then(setRepo); }, []);
  // Card audio plays with the ring/silent switch on: it only ever plays because you opened a card
  // with audio or pressed Play. iOS mutes an app's audio in silent mode unless it asks for this,
  // which silenced recordings, text-to-speech and the play buttons on template cards alike.
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined); }, []);

  const refresh = useCallback(async () => {
    if (!repo) return;
    const now = new Date();
    const [notes, cards, allParams, studiedByDeck, lastBackup, settings] = await Promise.all([
      repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.studiedToday(now, DAY_STARTS_AT_HOUR), repo.lastBackupAt(),
      repo.listDeckSettings(),
    ]);
    const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
    setDecks(deckRows({
      cardsByDeck: groupByDeck(cards, deckOf),
      limitsFor: (d) => deckLimits(paramsForDeck(d, allParams), { newPerDay: NEW_PER_DAY, reviewsPerDay: REVIEWS_PER_DAY }),
      studiedByDeck,
      gateFor: (d) => settings.get(d)?.gateCap,
      dayStartsAtHour: DAY_STARTS_AT_HOUR,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      now,
    }));
    setBackup(backupStatus(lastBackup, now, cards.length > 0));
    setAnkiUnsent((await repo.ankiStatus()).unsent);
  }, [repo]);

  useEffect(() => { if (screen.name === 'decks') refresh(); }, [screen, refresh]);

  if (!repo) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    // The safe-area insets every Screen pads itself by (status bar, Dynamic Island, home indicator).
    <SafeAreaProvider>
      {screen.name === 'decks' && (
        <DeckList decks={decks} backup={backup} ankiUnsent={ankiUnsent} onOpen={(deck) => setScreen({ name: 'review', deck })} onImport={() => setScreen({ name: 'anki' })}
          onBackup={() => setScreen({ name: 'backup' })}
          onOptions={(deck) => setScreen({ name: 'deckOptions', deck })}
        />
      )}
      {screen.name === 'anki' && <AnkiTransfer repo={repo} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'backup' && <Backup store={repo} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'deckOptions' && <DeckOptions repo={repo} deck={screen.deck} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'review' && <Review repo={repo} deck={screen.deck} onDone={() => setScreen({ name: 'decks' })} />}
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
