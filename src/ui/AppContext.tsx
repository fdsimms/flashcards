import { setAudioModeAsync } from 'expo-audio';
import { usePathname, useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { studyDayStart } from '../core/day';
import { listedDecks } from '../core/deckNames';
import { deckRows, queueInput, type DeckRow } from '../core/deckTree';
import { studiedToday } from '../core/queue';
import type { Note } from '../core/types';
import { backupStatus } from '../db/backup';
import type { AnkiLink, SyncSettings } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { openRepo, type BackupStore } from '../db/sqliteRepo';
import { useTheme } from './theme';
import { boostFor } from '../core/priority';
import { applyPriorityStamps } from '../db/priorityStamps';
import { loadHeld } from './lookalikeHold';
import { useCollapsedDecks, type CollapsedDecks } from './useCollapsedDecks';
import { useReader, type ReaderState } from './useReader';
import { useCountsReport } from './useCountsReport';
import { useDeckSnapshot } from './useDeckSnapshot';
import { useSync } from './useSync';
import { useWaniKani, type WaniKaniState } from './useWaniKani';

/**
 * What the screens share, held above the router so it survives moving between them: the open
 * repo, the deck list's rows, backup and Anki reminders, and sync. It was `App`'s state back when
 * `App` switched the screens itself.
 */

export type AppRepo = Repo & BackupStore & AnkiLink;

/** What the note editor hands back when it closes; none when it was closed without saving. */
/** `cardsChanged`: the note wasn't saved, but a card was unsuspended, unburied or unflagged in it. */
export type NoteEditorResult = { saved: Note } | { deleted: string } | { cardsChanged: true };
/** A note to edit, or a new one in `deck`, with `model` and `fields` filled in when given (Read & Listen's marked words). */
export type NoteEditorTarget = { noteId: string } | { deck: string | null; model?: string; fields?: Record<string, string> };

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
  /** The deck list's collapsed decks (useCollapsedDecks). */
  collapse: CollapsedDecks;
  /**
   * Opens the note editor over the current screen. `onClose` is called once, with what happened:
   * nothing when it was closed without saving.
   */
  openNoteEditor: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  /** Called by the note editor's screen when it closes. */
  finishNoteEditor: (result?: NoteEditorResult) => void;
  /** Read & Listen: its server, sign-in and settings (useReader). */
  reader: ReaderState;
  /** WaniKani: its token, options, counts and answers waiting to be sent (useWaniKani). */
  wanikani: WaniKaniState;
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
  const collapse = useCollapsedDecks(repo);
  const snapshot = useDeckSnapshot(repo, setDecks);
  // The collection's "Next day starts at", for counting marked words added per study day.
  const [dayStartsAtHour, setDayStartsAtHour] = useState(DAY_STARTS_AT_HOUR);

  useEffect(() => { openRepo().then(setRepo); }, []);
  // Card audio plays with the ring/silent switch on: it only ever plays because you opened a card
  // with audio or pressed Play (and by the reader, which also plays in the background while it's
  // open: src/ui/Reader.tsx). iOS mutes an app's audio in silent mode unless it asks for this,
  // which silenced recordings, text-to-speech and the play buttons on template cards alike.
  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined); }, []);

  const refresh = useCallback(async () => {
    if (!repo) return;
    const now = new Date();
    const collection = await repo.collectionSettings();
    setDayStartsAtHour(collection.dayStartsAtHour);
    const dayStart = studyDayStart(now, collection.dayStartsAtHour);
    const [notes, cards, allParams, reviews, revlog, lastBackup, savedSettings, ankiDecks] = await Promise.all([
      repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
      repo.lastBackupAt(), repo.listDeckSettings(), repo.ankiDecks(),
    ]);
    // Every answer given today, here or in Anki on another device (synced), counts toward the limits.
    const studied = studiedToday({ notes, cards, reviews, revlog, now, dayStartsAtHour: collection.dayStartsAtHour });
    const settings = await applyPriorityStamps(repo, notes, savedSettings, now);
    const held = await loadHeld(repo, { notes, cards, settings, now, dayStartsAtHour: collection.dayStartsAtHour });
    const rows = deckRows(queueInput({ notes, cards, params: allParams, studied, gateFor: (d) => settings.get(d)?.gateCap, collection, now, held, boostFor: boostFor({ notes, settings, now }) }), listedDecks(ankiDecks, settings), (d) => settings.get(d)?.position);
    setDecks(rows);
    snapshot.save(rows, now, collection.dayStartsAtHour);
    setBackup(backupStatus(lastBackup, now, cards.length > 0));
    setAnkiUnsent((await repo.ankiStatus()).unsent);
    collapse.load();
  }, [repo, collapse.load, snapshot.save]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const reader = useReader(syncSettings?.enabled ? syncSettings.server : undefined, dayStartsAtHour);
  useCountsReport(reader, decks, dayStartsAtHour);
  const wanikani = useWaniKani(repo, dayStartsAtHour);

  const editorClose = useRef<((result?: NoteEditorResult) => void) | null>(null);
  const openNoteEditor = useCallback((target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => {
    editorClose.current = onClose;
    const params: Record<string, string> = 'noteId' in target ? { noteId: target.noteId } : target.deck ? { deck: target.deck } : {};
    if (!('noteId' in target)) {
      if (target.model) params.model = target.model;
      if (target.fields) params.fields = JSON.stringify(target.fields);
    }
    router.push({ pathname: '/note-editor', params });
  }, [router]);
  const finishNoteEditor = useCallback((result?: NoteEditorResult) => {
    const close = editorClose.current;
    editorClose.current = null;
    close?.(result);
  }, []);

  const value = useMemo<AppValue | null>(() => repo && {
    repo, decks, backup, ankiUnsent, syncSettings, syncing,
    sync, reloadSync, refresh, collapse, openNoteEditor, finishNoteEditor, reader, wanikani,
  }, [repo, decks, backup, ankiUnsent, syncSettings, syncing, sync, reloadSync, refresh, collapse, openNoteEditor, finishNoteEditor, reader, wanikani]);

  if (!value) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
