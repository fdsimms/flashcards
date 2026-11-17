import React, { useState } from 'react';
import { Stack } from 'expo-router';
import { ActivityIndicator, ScrollView } from 'react-native';
import { failureText } from '../core/failure';
import type { Api, Language, Settings, VoiceSlot } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { sampleLine, searchVoices, slotInfo, voicesForSlot } from '../reader/voiceSlots';
import { AzureVoiceRows, AzureVoiceTerms, useAzureSample, useAzureVoices } from './AzureVoices';
import { ErrorNote, Group, Help, Screen } from './kit';
import { space, useTheme, readable } from './theme';

/**
 * One of a language's voice slots: the voices of its gender to choose from, the chosen one checked.
 * Choosing plays a line in it and saves it; the texts waiting to be read are recorded again.
 */
export function ReadVoicePick({ api, language, slot, selected, onSettings }: {
  api: Api;
  language: Language;
  slot: VoiceSlot;
  /** The voice the slot has now. */
  selected: string | undefined;
  /** The settings as the server has them after a change, for the rest of the app. */
  onSettings: (settings: Settings) => void;
}) {
  const c = useTheme();
  const { label, gender } = slotInfo(slot);
  const [chosen, setChosen] = useState<string>();
  const [error, setError] = useState<string>();
  const azure = useAzureVoices(api, language);
  const sample = useAzureSample(api);

  const choose = async (voice: string) => {
    const before = chosen;
    setChosen(voice);
    setError(undefined);
    sample.play(sampleLine(language, gender), voice, language);
    try {
      onSettings(await api.updateSettings({ voices: { [language]: { [slot]: voice } } }));
    } catch (e) {
      setChosen(before);
      setError(failureText(e, { what: "Couldn't save the voice.", next: 'Try again.' }));
    }
  };

  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const options = azure.voices ? searchVoices(voicesForSlot(azure.voices, slot), query) : undefined;

  return (
    <Screen title={label}>
      <Stack.SearchBar placeholder="Search voices" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {sample.error ? <ErrorNote message={sample.error} /> : null}
        {!options && !azure.error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {options ? (
          <Group accessibilityRole="radiogroup">
            <AzureVoiceRows voices={options} selected={chosen ?? selected} onChoose={(v) => { if (v) choose(v.voice); }} />
          </Group>
        ) : null}
        {options && searching && options.length === 0 ? <Help>{`No voices match "${query.trim()}".`}</Help> : null}
        {options && !searching && options.length === 0 ? <Help>{`Azure lists no ${gender === 'male' ? "men's" : "women's"} voices in ${LANGUAGES[language].name}.`}</Help> : null}
        {options ? <AzureVoiceTerms voices={options} /> : null}
        <Help>{`Choosing a voice plays a line in it. Only ${gender === 'male' ? "men's" : "women's"} voices are listed here.`}</Help>
      </ScrollView>
    </Screen>
  );
}
