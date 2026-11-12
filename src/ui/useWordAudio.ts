import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef } from 'react';
import type { Note } from '../core/types';
import type { Repo } from '../db/repo';
import { mediaFileUri } from '../media/mediaFiles';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { recordingIndex, wordPlayback } from '../reader/wordAudio';
import { usePhoneSpeech } from './usePhoneSpeech';

/**
 * Plays a word tapped in Read & Listen: the recording on its deck note when it has one and the
 * file is on the phone, else the phone's voice for the language (Settings, Voices). Neither
 * calls a server. The deck's notes are read once, when the reader opens, and each language's
 * recordings are indexed the first time one of its words is played.
 */
export function useWordAudio(repo: Repo) {
  const phone = usePhoneSpeech(repo);
  const notes = useRef<Promise<Note[]> | null>(null);
  const indexes = useRef(new Map<Language, Map<string, string>>());
  const player = useRef<AudioPlayer | null>(null);
  const speaking = useRef(false);

  useEffect(() => {
    notes.current = repo.listNotes();
    notes.current.catch(() => undefined);
    return () => { player.current?.remove(); player.current = null; Speech.stop(); };
  }, [repo]);

  return useCallback(async (word: string, language: Language) => {
    let index = indexes.current.get(language);
    if (!index) {
      // Without the notes the word is still read by the phone's voice.
      index = recordingIndex(await (notes.current ?? Promise.resolve([])).catch(() => []), language);
      indexes.current.set(language, index);
    }
    const what = wordPlayback(index, word);
    // Stopping speech that isn't running can cut off the recording that starts right after.
    if (speaking.current) { Speech.stop(); speaking.current = false; }
    player.current?.pause();
    const uri = what.file ? mediaFileUri(what.file) : undefined;
    if (uri) {
      player.current ??= createAudioPlayer(null, { keepAudioSessionActive: true });
      player.current.replace({ uri });
      player.current.play();
      return;
    }
    speaking.current = true;
    phone.sayWord(what.text, LANGUAGES[language].speech);
  }, [phone]);
}
