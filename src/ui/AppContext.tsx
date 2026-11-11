import { setAudioModeAsync } from 'expo-audio';
import { usePathname, useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, NEW_PER_DAY, REVIEWS_PER_DAY } from '../core/config';
import { studyDayStart } from '../core/day';
import { deckLimits, deckRows, groupByDeck, type DeckRow } from '../core/deckTree';
import { studiedToday } from '../core/queue';
import { paramsForDeck } from '../core/scheduler';
import type { Note } from '../core/types';
import { backupStatus } from '../db/backup';
import type { AnkiLink, SyncSettings } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { openRepo, type BackupStore } from '../db/sqliteRepo';
import { useTheme } from './theme';
import { useSync } from './useSync';

/**
 * What the screens share, held above the router so it survives moving between them: the open
 * repo, the deck list's rows, backup and Anki reminders, and sync. It was `App`'s state back when
 * `App` switched the screens itself.
 */

export type AppRepo = Repo & BackupStore & AnkiLink;

/** What the note editor hands back when it closes; none when it was closed without saving. */
export type NoteEditorResult = { saved: Note } | { deleted: string };
export type NoteEditorTarget = { noteId: string } | { deck: string | null };

interface AppValue {
  repo: AppRepo;
  decks: DeckRow[];
  backup?: { text: string; overdue: boolean };
  /** Answers given here and not yet in Anki. */
  ankiUnsent: number;
  syncSettings?: SyncSettings;
  syncing: boolean;
  sync: () => Promise<string | undefined>;
  reloadSync: () => Promise<void>;
  /** Loads the deck list's rows again. */
  refresh: () => Promise<void>;
  /**
   * Opens the note editor over the current screen. `onClose` is called once, with what happened:
   * nothing when it was closed without saving.
   */
  openNoteEditor: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  /** Called by the note editor's screen when it closes. */
  finishNoteEditor: (result?: NoteEditorResult) => void;
}

const Context = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const app = useContext(Context);
  if (!app) throw new Error('useApp is used outside AppProvider');
  return app;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [repo, setRepo] = useState<AppRepo | null>(null);
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

  // Sync, when it's on: at launch, on coming back to the app (from the deck list, so a deck being
  // studied isn't changed under it), after studying a deck (Review's screen asks), and on leaving the app.
  const { settings: syncSettings, syncing, sync, reload: reloadSync } = useSync(repo, refresh);
  const onDecks = pathname === '/';
  const onDecksRef = useRef(onDecks);
  onDecksRef.current = onDecks;
  useEffect(() => { if (repo) sync(); }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || (state === 'active' && onDecksRef.current)) sync();
    });
    return () => sub.remove();
  }, [sync]);

  const editorClose = useRef<((result?: NoteEditorResult) => void) | null>(null);
  const openNoteEditor = useCallback((target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => {
    editorClose.current = onClose;
    router.push({
      pathname: '/note-editor',
      params: 'noteId' in target ? { noteId: target.noteId } : target.deck ? { deck: target.deck } : {},
    });
  }, [router]);
  const finishNoteEditor = useCallback((result?: NoteEditorResult) => {
    const close = editorClose.current;
    editorClose.current = null;
    close?.(result);
  }, []);

  const value = useMemo<AppValue | null>(() => repo && {
    repo, decks, backup, ankiUnsent, syncSettings, syncing,
    sync, reloadSync, refresh, openNoteEditor, finishNoteEditor,
  }, [repo, decks, backup, ankiUnsent, syncSettings, syncing, sync, reloadSync, refresh, openNoteEditor, finishNoteEditor]);

  if (!value) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
