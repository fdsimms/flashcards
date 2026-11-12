import { setAudioModeAsync } from 'expo-audio';
import { usePathname, useRouter } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, View } from 'react-native';
import { collapsedDecks, setDeckCollapsed } from '../anki/noteService';
import { DAY_STARTS_AT_HOUR } from '../core/config';
import { studyDayKey, studyDayStart } from '../core/day';
import { deckRows, queueInput, type DeckRow } from '../core/deckTree';
import { studiedToday } from '../core/queue';
import type { Note } from '../core/types';
import { backupStatus } from '../db/backup';
import type { AnkiLink, SyncSettings } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { createApi, readerAddress, type Api, type Settings as ReaderSettings } from '../reader/api';
import { minedOne, miningLeft, type MiningCount } from '../reader/mining';
import { clearPassphrase, loadMined, loadPassphrase, loadPrefs, saveMined } from '../reader/storage';
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
  /** Decks whose subdecks the deck list hides: Anki's own collapsed state, shared through sync. */
  collapsed: Set<string>;
  toggleCollapsed: (deck: string) => void;
  /**
   * Opens the note editor over the current screen. `onClose` is called once, with what happened:
   * nothing when it was closed without saving.
   */
  openNoteEditor: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  /** Called by the note editor's screen when it closes. */
  finishNoteEditor: (result?: NoteEditorResult) => void;
  /** Read & Listen's server, once its passphrase is saved; null while it's off. */
  readerApi: Api | null;
  /** The sync server's address, which Read & Listen's server runs beside; undefined while sync is off. */
  readerServer?: string;
  /** Why Read & Listen's settings opened by themselves, e.g. the passphrase changed on the server. */
  readerNotice: string | null;
  signedInToReader: (passphrase: string) => void;
  signOutOfReader: () => void;
  /**
   * Read & Listen's settings as its server has them (which deck is each language's), for Review's
   * "Read a text with these words" and adding marked words to the deck; null until loaded.
   */
  readerSettings: ReaderSettings | null;
  setReaderSettings: (settings: ReaderSettings) => void;
  /** How many more marked words can be added to the deck today (src/reader/mining.ts). */
  miningLeft: number;
  /** Counts one more marked word added to the deck today. */
  recordMined: () => void;
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
  // Collapsed decks, read on their own: reading Anki's waits while a sync holds the collection, and
  // the deck list shouldn't. A read started before the latest toggle is out of date and dropped.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const collapseSeq = useRef(0);
  const loadCollapsed = useCallback(() => {
    if (!repo) return;
    const seq = collapseSeq.current;
    collapsedDecks(repo).then((s) => { if (seq === collapseSeq.current) setCollapsed(s); }).catch(() => undefined);
  }, [repo]);
  const toggleCollapsed = useCallback((deck: string) => {
    if (!repo) return;
    const next = !collapsed.has(deck);
    collapseSeq.current++;
    setCollapsed((prev) => { const s = new Set(prev); if (next) s.add(deck); else s.delete(deck); return s; });
    setDeckCollapsed(repo, deck, next).catch((e) => {
      Alert.alert(`Couldn't ${next ? 'collapse' : 'expand'} ${deck}`, `It's back as it was. ${e instanceof Error ? e.message : String(e)}`);
      loadCollapsed();
    });
  }, [repo, collapsed, loadCollapsed]);
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
    const [notes, cards, allParams, reviews, revlog, lastBackup, settings] = await Promise.all([
      repo.listNotes(), repo.listCards(), repo.listDeckParams(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
      repo.lastBackupAt(), repo.listDeckSettings(),
    ]);
    // Every answer given today, here or in Anki on another device (synced), counts toward the limits.
    const studied = studiedToday({ notes, cards, reviews, revlog, now, dayStartsAtHour: collection.dayStartsAtHour });
    setDecks(deckRows(queueInput({ notes, cards, params: allParams, studied, gateFor: (d) => settings.get(d)?.gateCap, collection, now })));
    setBackup(backupStatus(lastBackup, now, cards.length > 0));
    setAnkiUnsent((await repo.ankiStatus()).unsent);
    loadCollapsed();
  }, [repo, loadCollapsed]);

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
      router.dismissAll();
      router.push('/read-settings');
    })
    : null), [readerServer, readerPassphrase, router]);
  const signedInToReader = useCallback((passphrase: string) => { setReaderNotice(null); setReaderPassphrase(passphrase); }, []);
  const signOutOfReader = useCallback(() => {
    clearPassphrase().catch(() => undefined);
    setReaderPassphrase(null);
  }, []);

  const [readerSettings, setReaderSettings] = useState<ReaderSettings | null>(null);
  useEffect(() => {
    setReaderSettings(null);
    readerApi?.settings().then(setReaderSettings, () => undefined);
  }, [readerApi]);
  const [mined, setMined] = useState<MiningCount | null>(null);
  useEffect(() => { loadMined().then(setMined); }, []);
  const today = studyDayKey(new Date(), dayStartsAtHour);
  const recordMined = useCallback(() => {
    setMined((before) => {
      const next = minedOne(before, studyDayKey(new Date(), dayStartsAtHour));
      saveMined(next);
      return next;
    });
  }, [dayStartsAtHour]);

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
    sync, reloadSync, refresh, collapsed, toggleCollapsed, openNoteEditor, finishNoteEditor,
    readerApi, readerServer, readerNotice, signedInToReader, signOutOfReader,
    readerSettings, setReaderSettings, miningLeft: miningLeft(mined, today), recordMined,
  }, [repo, decks, backup, ankiUnsent, syncSettings, syncing, sync, reloadSync, refresh, collapsed, toggleCollapsed, openNoteEditor, finishNoteEditor,
    readerApi, readerServer, readerNotice, signedInToReader, signOutOfReader, readerSettings, mined, today, recordMined]);

  if (!value) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
