import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
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
import { Browse } from './src/ui/Browse';
import { Settings } from './src/ui/Settings';
import { Stats } from './src/ui/Stats';
import { SyncSettings } from './src/ui/SyncSettings';
import { useTheme } from './src/ui/theme';
import { useSync } from './src/ui/useSync';
import { syncStatusText } from './src/anki/sync/runSync';
import { createApi, readerAddress } from './src/reader/api';
import { clearPassphrase, loadPassphrase, loadPrefs } from './src/reader/storage';
import { Reader, type ReaderSource } from './src/ui/Reader';
import { ReadGrammar } from './src/ui/ReadGrammar';
import { ReadPastTexts } from './src/ui/ReadPastTexts';
import { ReadSettings } from './src/ui/ReadSettings';
import { ReadTopics } from './src/ui/ReadTopics';
import { ReadWords } from './src/ui/ReadWords';

type Screen =
  | { name: 'decks' } | { name: 'stats' } | { name: 'settings' } | { name: 'browse' }
  // Opened from Settings, or from the deck list (its first-run card and its reminders): back goes there.
  | { name: 'anki'; from: 'decks' | 'settings' } | { name: 'backup'; from: 'decks' | 'settings' } | { name: 'sync'; from: 'decks' | 'settings' }
  | { name: 'review'; deck: string } | { name: 'deckOptions'; deck: string }
  // Read & Listen: its home (topics), the reader, and the lists it opens; its settings open from
  // Settings, or from the deck list when the server stops accepting the passphrase.
  | { name: 'read' } | { name: 'reader'; source: ReaderSource } | { name: 'readPast' } | { name: 'readWords' } | { name: 'readGrammar' }
  | { name: 'readSettings'; from: 'decks' | 'settings' };

const READ_SCREENS = new Set<Screen['name']>(['read', 'reader', 'readPast', 'readWords', 'readGrammar']);

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
  // The reader also plays in the background while it's open (src/ui/Reader.tsx).
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

  // Sync, when it's on: at launch, on coming back to the app (from the deck list, so a deck being
  // studied isn't changed under it), after studying a deck, and on leaving the app.
  const { settings: syncSettings, syncing, sync, reload: reloadSync } = useSync(repo, refresh);
  const screenRef = useRef(screen);
  screenRef.current = screen;
  useEffect(() => { if (repo) sync(); }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || (state === 'active' && screenRef.current.name === 'decks')) sync();
    });
    return () => sub.remove();
  }, [sync]);

  // Read & Listen: on once its passphrase is saved, at the address beside the sync server. The
  // reader's own settings are read with the passphrase, so it opens with them.
  const [readerPassphrase, setReaderPassphrase] = useState<string | null>();
  const [readerNotice, setReaderNotice] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([loadPassphrase(), loadPrefs()]).then(([saved]) => setReaderPassphrase(saved), () => setReaderPassphrase(null));
  }, []);
  const readerServer = syncSettings?.enabled ? syncSettings.server : undefined;
  const readerApi = useMemo(() => (readerServer && readerPassphrase
    ? createApi(readerAddress(readerServer), readerPassphrase, fetch, () => {
      // The passphrase was changed on the server: forget it and ask again, rather than fail every call.
      clearPassphrase().catch(() => undefined);
      setReaderPassphrase(null);
      setReaderNotice('The passphrase changed on the server. Enter the new one.');
      setScreen({ name: 'readSettings', from: 'decks' });
    })
    : null), [readerServer, readerPassphrase]);
  const turnOffReader = () => {
    clearPassphrase().catch(() => undefined);
    setReaderPassphrase(null);
  };

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
        <DeckList decks={decks} backup={backup} ankiUnsent={ankiUnsent} onOpen={(deck) => setScreen({ name: 'review', deck })} onImport={() => setScreen({ name: 'anki', from: 'decks' })}
          onBackup={() => setScreen({ name: 'backup', from: 'decks' })}
          onSettings={() => setScreen({ name: 'settings' })}
          onBrowse={() => setScreen({ name: 'browse' })}
          onOptions={(deck) => setScreen({ name: 'deckOptions', deck })}
          onRead={readerApi ? () => setScreen({ name: 'read' }) : undefined}
          sync={syncSettings?.enabled ? {
            syncing,
            status: syncStatusText(syncSettings, new Date()),
            failed: !!syncSettings.lastError,
            onSync: () => { sync(); },
          } : undefined}
        />
      )}
      {screen.name === 'anki' && (
        <AnkiTransfer repo={repo} syncOn={!!syncSettings?.enabled} onSyncSettings={() => setScreen({ name: 'sync', from: screen.from })}
          backLabel={screen.from === 'settings' ? 'Settings' : 'Decks'} onDone={() => setScreen(screen.from === 'settings' ? { name: 'settings' } : { name: 'decks' })} />
      )}
      {screen.name === 'sync' && (
        <SyncSettings repo={repo} settings={syncSettings} syncing={syncing} sync={sync} reload={reloadSync} onDone={() => setScreen({ name: 'anki', from: screen.from })} />
      )}
      {screen.name === 'browse' && <Browse repo={repo} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'settings' && (
        <Settings repo={repo} backupText={backup?.text} readerOn={!!readerApi} onDone={() => setScreen({ name: 'decks' })}
          onRead={() => setScreen({ name: 'readSettings', from: 'settings' })}
          onAnki={() => setScreen({ name: 'anki', from: 'settings' })}
          onStats={() => setScreen({ name: 'stats' })}
          onBackup={() => setScreen({ name: 'backup', from: 'settings' })} />
      )}
      {screen.name === 'stats' && <Stats repo={repo} backLabel="Settings" onDone={() => setScreen({ name: 'settings' })} />}
      {screen.name === 'backup' && (
        <Backup store={repo} backLabel={screen.from === 'settings' ? 'Settings' : 'Decks'} onDone={() => setScreen(screen.from === 'settings' ? { name: 'settings' } : { name: 'decks' })} />
      )}
      {screen.name === 'deckOptions' && <DeckOptions repo={repo} deck={screen.deck} onDone={() => setScreen({ name: 'decks' })} />}
      {screen.name === 'review' && <Review repo={repo} deck={screen.deck} onDone={() => { setScreen({ name: 'decks' }); sync(); }} />}
      {(screen.name === 'readSettings' || (READ_SCREENS.has(screen.name) && !readerApi)) && (
        <ReadSettings
          syncServer={readerServer}
          signedIn={!!readerApi}
          notice={readerNotice}
          backLabel={screen.name === 'readSettings' && screen.from === 'settings' ? 'Settings' : 'Decks'}
          onDone={() => setScreen(screen.name === 'readSettings' && screen.from === 'settings' ? { name: 'settings' } : { name: 'decks' })}
          onSignedIn={(passphrase) => { setReaderNotice(null); setReaderPassphrase(passphrase); }}
          onSignOut={turnOffReader}
          onSyncSetup={() => setScreen({ name: 'sync', from: 'settings' })}
        />
      )}
      {readerApi && screen.name === 'read' && (
        <ReadTopics api={readerApi} onDone={() => setScreen({ name: 'decks' })}
          onOpen={(topic) => setScreen({ name: 'reader', source: { kind: 'topic', topic } })}
          onPast={() => setScreen({ name: 'readPast' })}
          onWords={() => setScreen({ name: 'readWords' })}
          onGrammar={() => setScreen({ name: 'readGrammar' })} />
      )}
      {readerApi && screen.name === 'reader' && (
        <Reader api={readerApi} source={screen.source}
          onDone={() => setScreen(screen.source.kind === 'past' ? { name: 'readPast' } : { name: 'read' })} />
      )}
      {readerApi && screen.name === 'readPast' && (
        <ReadPastTexts api={readerApi} onDone={() => setScreen({ name: 'read' })} onOpen={(text) => setScreen({ name: 'reader', source: { kind: 'past', text } })} />
      )}
      {readerApi && screen.name === 'readWords' && <ReadWords api={readerApi} onDone={() => setScreen({ name: 'read' })} />}
      {readerApi && screen.name === 'readGrammar' && <ReadGrammar api={readerApi} onDone={() => setScreen({ name: 'read' })} />}
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
