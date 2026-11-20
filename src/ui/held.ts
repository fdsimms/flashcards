import { Paths } from 'expo-file-system';
import { readJsonSafely, writeJsonSafely } from '../media/safeJson';
import { useEffect, useSyncExternalStore } from 'react';
import { parseRecordings, type HeldRecording } from '../core/held';
import { parseHeldReader, type HeldReaderAction } from '../reader/downloads';
import { parseHeldWords, type HeldWords } from '../reader/heldNotes';

/**
 * The work held while offline (src/core/held.ts), one copy for every screen, kept in the documents
 * folder so a word or a recording held on the subway is still waiting after the app is closed.
 * Read once, by the first screen or change that needs it; every change is written straight back.
 */
function persistedList<T>(fileName: string, parse: (raw: unknown) => T[]) {
  let value: T[] = [];
  let loaded: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): T[] => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load(): Promise<void> {
      loaded ??= (async () => {
        try {
          value = parse(await readJsonSafely(Paths.document, fileName));
          listeners.forEach((l) => l());
        } catch {
          // An unreadable file holds nothing to send.
        }
      })();
      return loaded;
    },
    /** Changes the list, once it's been read, so a change can't write over what was in the file. */
    async update(change: (list: T[]) => T[]): Promise<void> {
      await this.load();
      const next = change(value);
      value = next;
      listeners.forEach((l) => l());
      try {
        // Written so a kill mid-write can't empty it (safeJson.ts): this is work waiting to be sent.
        writeJsonSafely(Paths.document, fileName, next);
      } catch {
        // Still held in memory, and sent while the app is open.
      }
    },
  };
}

export const heldWords = persistedList<HeldWords>('held-words.json', parseHeldWords);
export const heldRecordings = persistedList<HeldRecording>('held-recordings.json', parseRecordings);
/** Readings, listens and story choices made in Read & Listen offline (reader/downloads.ts), sent in order. */
export const heldReader = persistedList<HeldReaderAction>('held-reader.json', parseHeldReader);

export function useHeldWords(): HeldWords[] {
  useEffect(() => { void heldWords.load(); }, []);
  return useSyncExternalStore(heldWords.subscribe, heldWords.get);
}

export function useHeldReader(): HeldReaderAction[] {
  useEffect(() => { void heldReader.load(); }, []);
  return useSyncExternalStore(heldReader.subscribe, heldReader.get);
}

export function useHeldRecordings(): HeldRecording[] {
  useEffect(() => { void heldRecordings.load(); }, []);
  return useSyncExternalStore(heldRecordings.subscribe, heldRecordings.get);
}
