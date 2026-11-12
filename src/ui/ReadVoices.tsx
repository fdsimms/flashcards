import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { azureVoiceName } from '../core/voices';
import { ApiError, type Api, type Language, type Settings, type Speakers } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { hasVoiceSlots, sharesVoice, VOICE_SLOTS } from '../reader/voiceSlots';
import { ErrorNote, Group, Help, NavRow, Screen } from './kit';
import { space } from './theme';

/**
 * The Azure voices a language's texts are read in, by gender: a man's and a woman's, and a second
 * of each for a dialogue between two men or two women. Each row opens its list (ReadVoicePick).
 * The server keeps the choice; the texts waiting to be read are recorded again in it, and a text
 * already read keeps its audio.
 */
export function ReadVoices({ api, language, voices, onSettings, onPick }: {
  api: Api;
  language: Language;
  /** The language's voices as the app last had them from the server, if it has them yet. */
  voices: Partial<Speakers> | undefined;
  /** The settings as the server has them after a load, for the rest of the app. */
  onSettings: (settings: Settings) => void;
  onPick: (slot: keyof Speakers) => void;
}) {
  const name = LANGUAGES[language].name;
  const [error, setError] = useState<string>();
  const known = hasVoiceSlots(voices);

  useEffect(() => {
    if (known) return;
    let live = true;
    api.settings().then(
      (s) => { if (live) onSettings(s); },
      (e) => { if (live) setError(e instanceof ApiError ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [api, known]); // eslint-disable-line react-hooks/exhaustive-deps -- onSettings is the app's setter

  // The settings loaded, but the server sends voices by speaker: it hasn't been updated yet.
  const outdated = !known && voices !== undefined;

  return (
    <Screen title={`${name} voices`}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {outdated ? <ErrorNote message="Read & Listen's server doesn't offer voices by gender yet. It updates itself within about 15 minutes of an update; try again then." /> : null}
        {known ? (
          <>
            <Group>
              {VOICE_SLOTS.map((s, i) => (
                <NavRow key={s.slot} first={i === 0} label={s.label} detail={azureVoiceName(voices[s.slot])} onPress={() => onPick(s.slot)} />
              ))}
            </Group>
            <Help>
              {`Each text says whether its speakers are men or women, and reads them in these voices. When both speakers are the same gender, the second one is read in the second voice. A story's narrator uses the man's voice.`}
            </Help>
            {sharesVoice(voices) ? (
              <Help>{`A second voice that's the same as the first reads two men, or two women, in the same voice. Choose a different one to tell them apart.`}</Help>
            ) : null}
            <Help>
              {`Texts waiting to be read are recorded again in the new voices; a text you've already read keeps its audio.`}
            </Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
