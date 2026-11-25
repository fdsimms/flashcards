import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repo } from '../../db/repo';
import type { Api, Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { allWords, clipName, hearingVoices, HEARING, spokenText, type HearingWord } from '../../tools/hearing';
import { useOutputWake } from '../useOutputWake';
import { stopSpeechIfRunning, usePhoneSpeech } from '../usePhoneSpeech';
import { trackPlayer } from '../useSoundingButton';

/** Where Hearing sounds keeps its recordings and each language's voice list: the documents folder, so they stay for offline use. */
const folder = () => new Directory(Paths.document, 'hearing');

/** Which voice a word was played in: one of the Azure voices, or the phone's own, and why. */
export type HeardIn =
  | { kind: 'voice'; index: number; of: number }
  | { kind: 'phone'; why: 'off' | 'unreachable' | 'no-voices' };

/** A word as the phone's voice is given it: in kana for Japanese (a phone voice reads kanji one at a time), and a Russian word without its stress mark. */
const phoneText = (w: HearingWord): string => w.reading ?? w.say ?? w.word;

function voicesFile(language: Language): File {
  return new File(folder(), `voices-${language}.json`);
}

async function readSavedVoices(language: Language): Promise<string[]> {
  try {
    const f = voicesFile(language);
    if (!f.exists) return [];
    const parsed: unknown = JSON.parse(await f.text());
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveVoices(language: Language, voices: string[]): void {
  try {
    folder().create({ idempotent: true, intermediates: true });
    const f = voicesFile(language);
    f.create({ overwrite: true });
    f.write(JSON.stringify(voices));
  } catch {
    // Only a convenience for offline use: the list is asked for again next time.
  }
}

/** The word's recording in `voice`, made through Read & Listen's server the first time and kept. */
async function clipFor(api: Api | null, language: Language, word: HearingWord, voice: string): Promise<File | undefined> {
  const file = new File(folder(), clipName(word, voice));
  if (file.exists) return file;
  if (!api) return undefined;
  const bytes = await api.speech(spokenText(word), voice, 1, LANGUAGES[language].speech, word.reading);
  folder().create({ idempotent: true, intermediates: true });
  file.create({ overwrite: true });
  file.write(bytes);
  return file;
}

/**
 * Plays Hearing sounds' words. With Read & Listen on, each word is recorded once in each of the
 * language's Azure voices (`hearingVoices`, up to four) and kept on the phone, and every word is
 * recorded ahead in the background so the tool works offline afterward. A recording already kept
 * plays with Read & Listen off too, since that reaches nothing. Without one, the phone's voice
 * says the word, and `HeardIn` says so, so the screen can tell the learner it's one voice only.
 */
export function useHearingAudio(repo: Repo, api: Api | null, language: Language) {
  const phone = usePhoneSpeech(repo);
  const wake = useOutputWake();
  const [voices, setVoices] = useState<{ language: Language; list: string[]; unreachable: boolean } | null>(null);
  const player = useRef<AudioPlayer | null>(null);
  const untrack = useRef<(() => void) | null>(null);
  // Only the latest play sounds: one still recording or waiting on the headphones gives way to a newer one.
  const latest = useRef(0);

  useEffect(() => () => { untrack.current?.(); untrack.current = null; player.current?.remove(); player.current = null; Speech.stop(); }, []);

  // The language's voices: asked of the server and kept, or the kept list when it can't be asked.
  useEffect(() => {
    let live = true;
    (async () => {
      let list: string[] = [];
      let unreachable = false;
      if (api) {
        try {
          list = hearingVoices(await api.azureVoices(language), language);
          if (list.length) saveVoices(language, list);
        } catch {
          unreachable = true;
        }
      }
      if (!list.length) list = await readSavedVoices(language);
      if (live) setVoices({ language, list, unreachable });
    })();
    return () => { live = false; };
  }, [api, language]);
  const list = voices?.language === language ? voices.list : null;
  const unreachable = voices?.language === language && voices.unreachable;

  // Every word in every voice, recorded ahead one at a time, so a question plays at once and the
  // tool works offline. Stops at the first failure: the server is out of reach, and asking again
  // for each word would only fail as many times.
  useEffect(() => {
    const def = HEARING[language];
    if (!api || !list?.length || !def) return;
    let live = true;
    (async () => {
      for (const word of allWords(def)) {
        for (const voice of list) {
          if (!live) return;
          try {
            await clipFor(api, language, word, voice);
          } catch {
            return;
          }
        }
      }
    })();
    return () => { live = false; };
  }, [api, language, list]);

  const play = useCallback(async (word: HearingWord, turn: number): Promise<HeardIn> => {
    const mine = ++latest.current;
    await stopSpeechIfRunning();
    player.current?.pause();
    if (list?.length) {
      const index = ((turn % list.length) + list.length) % list.length;
      let file: File | undefined;
      try {
        file = await clipFor(api, language, word, list[index]);
      } catch {
        file = undefined;
      }
      if (mine !== latest.current) return { kind: 'voice', index, of: list.length };
      if (file) {
        // Bluetooth headphones that have been quiet lose the start of the next sound, all of a word.
        await wake();
        if (mine !== latest.current) return { kind: 'voice', index, of: list.length };
        if (!player.current) {
          player.current = createAudioPlayer(null, { keepAudioSessionActive: true });
          untrack.current = trackPlayer(player.current);
        }
        player.current.replace({ uri: file.uri });
        player.current.play();
        return { kind: 'voice', index, of: list.length };
      }
    }
    void phone.sayWord(phoneText(word), LANGUAGES[language].speech);
    return { kind: 'phone', why: !api ? 'off' : list?.length || unreachable ? 'unreachable' : 'no-voices' };
  }, [api, language, list, unreachable, phone, wake]);

  return { play, ready: list !== null, voiceCount: list?.length ?? 0 };
}
