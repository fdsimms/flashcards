import { Stack } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { azureVoiceName } from '../../core/voices';
import type { Api, CastKind, CastVoice, Language, Settings } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { auditionVoices, audioKey, castInfo, clampPitch, pitchLabel, PITCH_MAX, PITCH_MIN, PITCH_STEP, type AuditionFilter } from '../../reader/storyCast';
import { searchVoices } from '../../reader/voiceSlots';
import { AzureVoiceRows, AzureVoiceTerms, useAzureVoices } from '../AzureVoices';
import { haptic } from '../haptics';
import { Button, Chip, ErrorNote, Group, Help, Screen, SectionTitle } from '../kit';
import { PitchButton } from './ReadCastKind';
import { readable, space, type, useTheme } from '../theme';
import { useCastAudio } from './useCastAudio';

// How long after the last tap on the pitch buttons the chosen voice is played again.
const SETTLE_MS = 500;

/**
 * Plays one line in each of a language's voices at one pitch, so they can be compared before one is
 * saved for a kind of story character. Tapping a voice plays it and checks it; changing the pitch
 * plays the checked voice again. Nothing is saved until "Use", which saves the checked voice and
 * pitch for the kind, as the kind's own screen does.
 */
export function ReadCastAudition({ api, language, kind, current, onSettings, onSaved }: {
  api: Api;
  language: Language;
  kind: CastKind;
  /** The voice and pitch the kind has now: where the audition starts. */
  current: CastVoice;
  /** The settings as the server has them after a change, for the rest of the app. */
  onSettings: (settings: Settings) => void;
  onSaved: () => void;
}) {
  const c = useTheme();
  const { label, gender } = castInfo(kind);
  const azure = useAzureVoices(api, language);
  const audio = useCastAudio(api);
  const [filter, setFilter] = useState<AuditionFilter>('all');
  const [voice, setVoice] = useState(current.voice);
  const [pitch, setPitch] = useState(current.pitch);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const hear = (v: string, p: number) => audio.play(
    audioKey('sample', language, v, p, language === 'th' ? gender : ''),
    () => api.castSample(language, v, p, gender),
  );
  const nudge = (by: number) => {
    const next = clampPitch(pitch + by);
    if (next === pitch) return;
    haptic.select();
    setPitch(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => hear(voice, next), SETTLE_MS);
  };
  const use = async () => {
    setSaving(true);
    setError(undefined);
    try {
      onSettings(await api.updateSettings({ cast: { [language]: { [kind]: { voice, pitch } } } }));
      onSaved();
    } catch (e) {
      setError(failureText(e, { what: "Couldn't save the voice.", next: 'Try again.' }));
      setSaving(false);
    }
  };

  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const options = azure.voices ? searchVoices(auditionVoices(azure.voices, kind, filter), query) : undefined;
  const listed = azure.voices?.some((v) => v.voice === voice);
  const people = gender === 'male' ? "men's" : "women's";

  return (
    <Screen title="Audition">
      <Stack.SearchBar placeholder="Search voices" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {audio.error ? <ErrorNote message={audio.error} /> : null}
        <View style={{ flexDirection: 'row', gap: space.s, flexWrap: 'wrap' }}>
          <Chip label={`All ${people} voices`} selected={filter === 'all'} onPress={() => setFilter('all')} />
          <Chip label="Multilingual" selected={filter === 'multilingual'} onPress={() => setFilter('multilingual')} />
        </View>
        <SectionTitle>Pitch</SectionTitle>
        <Group>
          <View style={{ padding: space.l, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <PitchButton icon="minus" label="Lower the pitch" disabled={pitch <= PITCH_MIN} onPress={() => nudge(-PITCH_STEP)} />
            <Text accessibilityLiveRegion="polite" style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{pitchLabel(pitch)}</Text>
            <PitchButton icon="plus" label="Raise the pitch" disabled={pitch >= PITCH_MAX} onPress={() => nudge(PITCH_STEP)} />
          </View>
        </Group>
        <SectionTitle>Voices</SectionTitle>
        {!options && !azure.error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {options ? (
          <Group accessibilityRole="radiogroup">
            <AzureVoiceRows
              voices={options}
              selected={voice}
              onChoose={(v) => {
                if (!v) return;
                clearTimeout(timer.current);
                setVoice(v.voice);
                hear(v.voice, pitch);
              }}
            />
          </Group>
        ) : null}
        {options && searching && options.length === 0 ? <Help>{`No voices match "${query.trim()}".`}</Help> : null}
        {options && !searching && options.length === 0 ? <Help>{`Azure lists no ${filter === 'multilingual' ? 'Multilingual ' : ''}${people} voices in ${LANGUAGES[language].name}.`}</Help> : null}
        {options ? <AzureVoiceTerms voices={options} /> : null}
        <Button
          label={`Use ${azureVoiceName(voice)} at ${pitchLabel(pitch)} for ${label}`}
          onPress={use}
          busy={saving}
          disabled={!listed}
        />
        <Help>
          {`Tapping a voice plays one line in it at this pitch. Each new voice and pitch is a short Azure recording; one you've heard before plays from the phone. Using a voice changes the ${label.toLowerCase()} for characters given a voice from now on, not ones already in a story.`}
        </Help>
      </ScrollView>
    </Screen>
  );
}
