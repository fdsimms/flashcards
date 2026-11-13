import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { failureText } from '../core/failure';
import { recordingName } from '../core/recording';
import type { Api, AzureVoice } from '../reader/api';
import { CheckRow } from './kit';

/**
 * Azure's voices, as Read & Listen's server lists and speaks them: for Read & Listen's speakers
 * (ReadVoices) and for recording cards (Voices). Each screen asks for its language's list once.
 */

const errorText = (e: unknown) => failureText(e, { what: "Couldn't list the voices.", next: 'Try again.' });

/** A language's Azure voices (any code: th, pl, es-MX), or why they couldn't be listed. */
export function useAzureVoices(api: Api | null, language: string | undefined) {
  const [voices, setVoices] = useState<AzureVoice[]>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!api || !language) return;
    let live = true;
    setError(undefined);
    api.azureVoices(language).then(
      (v) => { if (live) setVoices(v); },
      (e) => { if (live) setError(errorText(e)); },
    );
    return () => { live = false; };
  }, [api, language, attempt]);
  return { voices, error, retry: () => setAttempt((n) => n + 1) };
}

/**
 * Plays `text` in an Azure voice, to hear it before choosing. Each sample is asked for once and
 * kept in the cache folder, named as a recording would be, so tapping a voice again plays at once.
 */
export function useAzureSample(api: Api | null) {
  const player = useRef<AudioPlayer | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => () => { player.current?.remove(); player.current = null; }, []);
  const play = useCallback(async (text: string, voice: string) => {
    if (!api) return;
    setError(undefined);
    player.current?.pause();
    try {
      const file = new File(Paths.cache, `sample-${recordingName(text, voice)}`);
      if (!file.exists) {
        const bytes = await api.speech(text, voice);
        file.create({ overwrite: true });
        await file.write(bytes);
      }
      player.current ??= createAudioPlayer();
      player.current.replace({ uri: file.uri });
      player.current.play();
    } catch (e) {
      setError(errorText(e));
    }
  }, [api]);
  return { play, error };
}

/** One row per voice, the chosen one checked; `none` adds a first row for choosing no voice. */
export function AzureVoiceRows({ voices, selected, onChoose, none }: {
  voices: AzureVoice[];
  selected: string | undefined;
  onChoose: (voice: AzureVoice | undefined) => void;
  none?: { label: string; hint: string };
}) {
  return (
    <>
      {none ? <CheckRow first label={none.label} hint={none.hint} selected={!selected} onPress={() => onChoose(undefined)} /> : null}
      {voices.map((v, i) => (
        <CheckRow
          key={v.voice}
          first={!none && i === 0}
          label={v.name}
          hint={[v.gender, v.locale].filter(Boolean).join(', ')}
          selected={selected === v.voice}
          onPress={() => onChoose(v)}
        />
      ))}
    </>
  );
}

/** A voice's display name (Premwadee), from the list; its id when it isn't there. */
export function voiceName(voices: AzureVoice[] | undefined, voice: string): string {
  return voices?.find((v) => v.voice === voice)?.name ?? voice;
}
