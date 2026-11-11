import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, NEW_PER_DAY, REVIEWS_PER_DAY } from './src/core/config';
import { studyDayStart } from './src/core/day';
import { deckLimits, deckRows, groupByDeck, type DeckRow } from './src/core/deckTree';
import { studiedToday } from './src/core/queue';
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
import { ScreenTransition } from './src/ui/motion';
import { useTheme } from './src/ui/theme';
import { useSync } from './src/ui/useSync';
import { syncStatusText } from './src/anki/sync/runSync';

type Screen =
  | { name: 'decks' } | { name: 'stats' } | { name: 'settings' } | { name: 'browse' }
  // Opened from Settings, or from the deck list (its first-run card and its reminders): back goes there.
  | { name: 'anki'; from: 'decks' | 'settings' } | { name: 'backup'; from: 'decks' | 'settings' } | { name: 'sync'; from: 'decks' | 'settings' }
  | { name: 'review'; deck: string } | { name: 'deckOptions'; deck: string };

/**
 * How deep a screen sits in the app (the deck list is 0), so moving to a deeper one slides in
 * from the right and moving to a shallower one slides in from the left.
 */
function depthOf(s: Screen): number {
  switch (s.name) {
    case 'decks': return 0;
    case 'settings': case 'browse': case 'review': case 'deckOptions': return 1;
    case 'anki': case 'backup': return s.from === 'settings' ? 2 : 1;
    case 'stats': return 2;
    case 'sync': return (s.from === 'settings' ? 2 : 1) + 1;
  }
}

export default function App() {
  const c = useTheme();
  const [repo, setRepo] = useState<(Repo & BackupStore & AnkiLink) | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'decks' });
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [backup, setBackup] = useState<{ text: string; overdue: boolean }>();
  const [ankiUnsent, setAnkiUnsent] = useState(0);
  const depth = depthOf(screen);
  const previousDepth = useRef(depth);
  const direction = Math.sign(depth - previousDepth.current) as -1 | 0 | 1;
  useEffect(() => { previousDepth.current = depth; }, [depth]);

  useEffect(() => { openRepo().then(setRepo); }, []);
  // Card audio plays with the ring/silent switch on: it only ever plays because you opened a card
  // with audio or pressed Play. iOS mutes an app's audio in silent mode unless it asks for this,
  // which silenced recordings, text-to-speech and the play buttons on template cards alike.
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined); }, []);

  const refresh = useCallback(async () => {
    if (!repo) return;
    const now = new Date();
    const dayStart = studyDayStart(now, DAY_STARTS_AT_HOUR);
    const [notes, cards, allParams, reviews, revlog, lastBackup, settings] = await Promise.all([
      repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
      repo.lastBackupAt(), repo.listDeckSettings(),
    ]);
    // Every answer given today, here or in Anki on another device (synced), counts toward the limits.
    const studiedByDeck = studiedToday({ notes, cards, reviews, revlog, now, dayStartsAtHour: DAY_STARTS_AT_HOUR });
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
      {/* The theme's background behind every screen, so a sliding one never shows white (or black) past its edge. */}
      <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScreenTransition key={screen.name} direction={direction}>
      {screen.name === 'decks' && (
        <DeckList decks={decks} backup={backup} ankiUnsent={ankiUnsent} onOpen={(deck) => setScreen({ name: 'review', deck })} onImport={() => setScreen({ name: 'anki', from: 'decks' })}
          onBackup={() => setScreen({ name: 'backup', from: 'decks' })}
          onSettings={() => setScreen({ name: 'settings' })}
          onBrowse={() => setScreen({ name: 'browse' })}
          onOptions={(deck) => setScreen({ name: 'deckOptions', deck })}
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
        <Settings repo={repo} backupText={backup?.text} onDone={() => setScreen({ name: 'decks' })}
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
      </ScreenTransition>
      </View>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
