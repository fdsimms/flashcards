import { useMemo } from 'react';
import { nativeWanted } from '../anki/nativeRecordings';
import type { RecordDeps } from '../anki/recordService';
import { headword } from '../core/forms';
import { readerLanguageOf } from '../core/leechHint';
import { hasMedia, readMedia, writeMedia } from '../media/mediaFiles';
import { useApp } from './AppContext';

/**
 * What recording a card's audio needs (src/anki/recordService.ts): Read & Listen's server to speak
 * the text, the media folder, the list of files the next sync sends, and the note service. Null
 * while Read & Listen is off, since its server is what holds the Azure key. Where native recordings
 * are on for the note's language (Settings, Voices; src/anki/nativeRecordings.ts), the same server
 * finds a native speaker's recording on Wikimedia Commons first.
 */
export function useRecorder(): RecordDeps | null {
  const { repo, reader } = useApp();
  const api = reader.api;
  return useMemo(() => {
    if (!api) return null;
    const media = repo.mediaSyncState();
    return {
      store: repo,
      speak: (text, voice, rate, language, reading) => api.speech(text, voice, rate, language, reading),
      native: async (note) => {
        const language = readerLanguageOf(note);
        if (!language || !nativeWanted(await repo.ankiNativeRecordings(), language)) return null;
        const word = headword(note);
        if (!word) return null;
        const found = (await api.nativeFind(language, [word])).results.find((r) => r.word === word)?.recordings[0];
        if (!found) return null;
        return { title: found.title, credit: found.credit, bytes: await api.nativeAudio(found.title) };
      },
      media: {
        exists: hasMedia,
        read: readMedia,
        write: writeMedia,
        recorded: (name) => media.recorded(name),
        setPending: (name, sha1) => media.setPending(name, sha1),
      },
    };
  }, [repo, api]);
}
