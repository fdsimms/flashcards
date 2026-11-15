import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { failureText } from '../core/failure';
import type { Api, CastKind, CastVoice, Language, Settings } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { audioKey, CAST_KINDS, castDetail, resetChange } from '../reader/storyCast';
import { Button, ErrorNote, Group, Help, NavRow, Screen, SectionTitle } from './kit';
import { space, readable } from './theme';
import { useCastAudio } from './useCastAudio';

/**
 * The voices a language's story characters are read in, by kind (a man, a girl, an older woman...):
 * the voice and pitch a story gives the first character of each kind, who keeps them in every
 * episode. Each row plays a sample and opens its choices (ReadCastKind); the scene button plays a
 * short scene in the voices as they are now. The server keeps the choice, and a story already running
 * keeps the voices it has given out.
 */
export function ReadCast({ api, language, cast, narrator, onSettings, onPick }: {
  api: Api;
  language: Language;
  cast: Record<CastKind, CastVoice>;
  /** The voice a story's narrator is read in: the language's man's voice. */
  narrator: string;
  /** The settings as the server has them after a change, for the rest of the app. */
  onSettings: (settings: Settings) => void;
  onPick: (kind: CastKind) => void;
}) {
  const audio = useCastAudio(api);
  const [error, setError] = useState<string>();
  const [resetting, setResetting] = useState(false);
  const name = LANGUAGES[language].name;

  const scene = () => audio.play(
    audioKey('scene', language, narrator, cast.girl.voice, cast.girl.pitch, cast.woman.voice, cast.woman.pitch),
    () => api.castScene(language),
  );
  const hear = (kind: CastKind, gender: 'male' | 'female') => audio.play(
    audioKey('sample', language, cast[kind].voice, cast[kind].pitch, language === 'th' ? gender : ''),
    () => api.castSample(language, cast[kind].voice, cast[kind].pitch, gender),
  );
  const reset = async () => {
    setError(undefined);
    setResetting(true);
    try {
      onSettings(await api.updateSettings(resetChange(language)));
    } catch (e) {
      setError(failureText(e, { what: "Couldn't put the voices back.", next: 'Try again.' }));
    } finally {
      setResetting(false);
    }
  };

  return (
    <Screen title="Story characters">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {audio.error ? <ErrorNote message={audio.error} /> : null}
        <Button label="Play the scene" onPress={scene} busy={audio.busy} accessibilityLabel={`Play a scene in ${name} read by the narrator and two characters`} />
        <SectionTitle>Characters</SectionTitle>
        <Group>
          {CAST_KINDS.map((k, i) => (
            <NavRow
              key={k.kind}
              first={i === 0}
              label={k.label}
              detail={castDetail(cast[k.kind])}
              onPress={() => onPick(k.kind)}
              action={{ icon: 'play.fill', label: `Hear ${k.label}`, onPress: () => hear(k.kind, k.gender) }}
            />
          ))}
        </Group>
        <Help>
          {`A story gives its first man, woman, boy, girl and so on the voice chosen here, and the character keeps it in every episode. A second of the same kind gets a voice and pitch nobody else in the story has. A story already running keeps the voices it has given out. The narrator uses the man's voice.`}
        </Help>
        <Button label="Reset to defaults" variant="secondary" onPress={reset} busy={resetting} />
      </ScrollView>
    </Screen>
  );
}
