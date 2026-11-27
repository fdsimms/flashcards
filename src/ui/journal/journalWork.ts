import { Paths } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';
import { isOffline } from '../../core/held';
import { readJsonSafely, writeJsonSafely } from '../../media/safeJson';
import type { Api, JournalEntry, JournalHome, Language } from '../../reader/api';
import { holdEntry, parseDrafts, type Draft } from '../../reader/journal';
import { mistakePatterns } from '../../tools/cases';
import { markList, recordMark } from '../../tools/marks';
import { loadToolMarks, saveToolMarks, toolMarks } from '../../tools/storage';
import { connection } from '../connection';
import { heldJournal, persistedList } from '../held';

/**
 * The phone's side of the journal (src/reader/journal.ts): the entry being written in each language, kept
 * as it's typed; the last copy of each language's journal, for opening it offline; checking an entry, or
 * holding it while the server can't be reached; and a first check's case endings marked as misses in Which
 * case. Nothing here grades a card.
 */

/** The entry being written in each language. */
export const journalDrafts = persistedList<Draft>('journal-drafts.json', parseDrafts);

export function useJournalDrafts(): Draft[] {
  useEffect(() => { void journalDrafts.load(); }, []);
  return useSyncExternalStore(journalDrafts.subscribe, journalDrafts.get);
}

/** A new id for an entry, so the server checks it once however often it's sent. */
export const newEntryKey = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const HOME_FILE = 'journal-home.json';

/** The language's journal as last read from the server, or null. */
export async function homeCopy(language: Language): Promise<JournalHome | null> {
  try {
    const all = await readJsonSafely(Paths.document, HOME_FILE);
    const home = all && typeof all === 'object' ? (all as Record<string, unknown>)[language] : undefined;
    return home && typeof home === 'object' && Array.isArray((home as JournalHome).entries) ? home as JournalHome : null;
  } catch {
    return null;
  }
}

/** Keeps `home` as the language's copy for offline. */
export async function keepHomeCopy(language: Language, home: JournalHome): Promise<void> {
  try {
    const all = await readJsonSafely(Paths.document, HOME_FILE).catch(() => null);
    const next = { ...(all && typeof all === 'object' ? all : {}), [language]: home };
    writeJsonSafely(Paths.document, HOME_FILE, next);
  } catch {
    // Only the offline copy is lost.
  }
}

/**
 * Marks each case ending a first check found as a miss in Which case for the entry's language
 * (`mistakePatterns`), so it and Today's extras lean toward that case. Only the first check counts, as
 * the server's counts do: a second try shows the same mistakes fixed or not, already counted.
 */
export function markCaseMistakes(entry: JournalEntry): void {
  if (entry.tries !== 1 || entry.language === 'tok') return;
  const language = entry.language;
  const misses = entry.check.sentences
    .flatMap((s) => s.mistakes)
    .map((m) => mistakePatterns(language, m.governor, m.case))
    .filter((p) => p.length);
  if (!misses.length) return;
  const list = markList('cases', language);
  void loadToolMarks().then(() => {
    let marks = toolMarks();
    for (const patterns of misses) marks = recordMark(marks, list, patterns, false, Date.now());
    saveToolMarks(marks);
  });
}

export interface CheckAsk {
  key: string;
  language: Language;
  text: string;
  prompt: string;
  entryId?: number;
}

/**
 * Checks an entry on the server and keeps it there, or, while the server can't be reached, holds it to be
 * checked when it can be (src/ui/HeldWork.tsx). Any other failure is thrown for the screen to show.
 */
export async function checkOrHold(api: Api, ask: CheckAsk): Promise<JournalEntry | 'held'> {
  const hold = async () => {
    await heldJournal.update((list) => holdEntry(list, { ...ask, at: Date.now() }));
    return 'held' as const;
  };
  if (connection.cantReachHome()) return hold();
  try {
    const entry = await api.checkJournal({ language: ask.language, text: ask.text, prompt: ask.prompt, entry_id: ask.entryId ?? null, key: ask.entryId ? null : ask.key });
    markCaseMistakes(entry);
    return entry;
  } catch (e) {
    if (isOffline(e)) return hold();
    throw e;
  }
}
