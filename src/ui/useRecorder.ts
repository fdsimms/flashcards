import { useMemo } from 'react';
import type { RecordDeps } from '../anki/recordService';
import { hasMedia, readMedia, writeMedia } from '../media/mediaFiles';
import { useApp } from './AppContext';

/**
 * What recording a card's audio needs (src/anki/recordService.ts): Read & Listen's server to speak
 * the text, the media folder, the list of files the next sync sends, and the note service. Null
 * while Read & Listen is off, since its server is what holds the Azure key.
 */
export function useRecorder(): RecordDeps | null {
  const { repo, reader } = useApp();
  const api = reader.api;
  return useMemo(() => {
    if (!api) return null;
    const media = repo.mediaSyncState();
    return {
      store: repo,
      speak: (text, voice, rate) => api.speech(text, voice, rate),
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
