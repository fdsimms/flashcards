import React, { useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { azureVoiceName } from '../core/voices';
import type { Api, AzureVoice } from '../reader/api';
import { saveNarrator } from '../reader/lessonStorage';
import { narratorVoices, sampleLine, searchVoices, type Gender } from '../reader/voiceSlots';
import { AzureVoiceRows, AzureVoiceTerms, useAzureSample, useAzureVoices } from './AzureVoices';
import { ErrorNote, Group, Help, Screen, Segments } from './kit';
import { space, type, useTheme, readable } from './theme';

/**
 * The English voice that narrates audio lessons ("How do you say..."), from Azure's English voices.
 * Choosing one plays a line in it and keeps it on this phone; a lesson is made with the voice
 * chosen when it's asked for, so lessons already made keep theirs.
 */
export function ReadNarratorPick({ api, current, serverDefault }: {
  api: Api;
  /** The voice chosen now, or '' for the server's own. */
  current: string;
  /** The server's own English voice, named on the first row. */
  serverDefault: string | undefined;
}) {
  const c = useTheme();
  // What was picked on this screen; until then the saved choice, which loads after the screen opens.
  const [picked, setChosen] = useState<string>();
  const chosen = picked ?? current;
  const [pickedGender, setGender] = useState<Gender>();
  const azure = useAzureVoices(api, 'en');
  const sample = useAzureSample(api);

  // Which gender's voices are listed: the one chosen, unless the toggle was used; men's until the list loads.
  const chosenGender = azure.voices?.find((v) => v.voice === chosen)?.gender?.toLowerCase();
  const gender: Gender = pickedGender ?? (chosenGender === 'female' ? 'female' : 'male');
  // A search looks through both genders, so the toggle and the Default row step aside while one is typed.
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const options = azure.voices
    ? searching
      ? searchVoices(narratorVoices(azure.voices, null), query)
      : narratorVoices(azure.voices, gender, chosen || undefined)
    : undefined;

  const choose = (picked: AzureVoice | undefined) => {
    const voice = picked?.voice ?? '';
    setChosen(voice);
    saveNarrator(voice);
    sample.play(sampleLine('en', 'male'), voice || serverDefault || 'en-US-GuyNeural', 'en');
  };

  return (
    <Screen title="Narrator">
      <Stack.SearchBar placeholder="Name, region or gender" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {sample.error ? <ErrorNote message={sample.error} /> : null}
        {!azure.voices && !azure.error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {options && !searching ? (
          <Segments<Gender>
            options={[{ value: 'male', label: 'Men' }, { value: 'female', label: 'Women' }]}
            value={gender}
            onChange={setGender}
          />
        ) : null}
        {options && searching && !options.length ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center', paddingTop: space.xl }}>No voices match "{query.trim()}".</Text>
        ) : null}
        {options && options.length ? (
          <Group accessibilityRole="radiogroup">
            <AzureVoiceRows
              voices={options}
              selected={chosen || undefined}
              onChoose={choose}
              none={searching ? undefined : { label: 'Default', hint: serverDefault ? azureVoiceName(serverDefault) : "The server's own voice" }}
            />
          </Group>
        ) : null}
        {options ? <AzureVoiceTerms voices={options} /> : null}
        <Help>Choosing a voice plays a line in it. American, British and Australian voices are listed. The narrator speaks the English in a lesson. It applies to lessons you make from now on.</Help>
      </ScrollView>
    </Screen>
  );
}
