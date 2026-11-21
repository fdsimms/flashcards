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
import { trackPlayer } from './useSoundingButton';

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
  const untrack = useRef<(() => void) | null>(null);

  useEffect(() => {
    notes.current = repo.listNotes();
    notes.current.catch(() => undefined);
    return () => { untrack.current?.(); untrack.current = null; player.current?.remove(); player.current = null; Speech.stop(); };
  }, [repo]);

  // `say`: what to speak in place of the word when there's no recording, e.g. a Japanese word's kana,
  // since a phone voice reads kanji one at a time (絶対 as ぜつ たい).
  return useCallback(async (word: string, language: Language, say?: string) => {
    let index = indexes.current.get(language);
    if (!index) {
      // Without the notes the word is still read by the phone's voice.
      index = recordingIndex(await (notes.current ?? Promise.resolve([])).catch(() => []), language);
      indexes.current.set(language, index);
    }
    const what = wordPlayback(index, word);
    // Stopping speech that isn't running can cut off the recording that starts right after, and the
    // voice's own end isn't visible here, so ask it rather than keep a flag that nothing clears.
    if (await Speech.isSpeakingAsync().catch(() => false)) Speech.stop();
    player.current?.pause();
    const uri = what.file ? mediaFileUri(what.file) : undefined;
    if (uri) {
      if (!player.current) {
        player.current = createAudioPlayer(null, { keepAudioSessionActive: true });
        untrack.current = trackPlayer(player.current);
      }
      player.current.replace({ uri });
      player.current.play();
      return;
    }
    phone.sayWord(say ?? what.text, LANGUAGES[language].speech);
  }, [phone]);
}
