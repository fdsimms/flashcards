import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { failureText } from '../core/failure';
import type { Api, Language, Settings, VoiceSlot } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { sampleLine, slotInfo, voicesForSlot } from '../reader/voiceSlots';
import { AzureVoiceRows, useAzureSample, useAzureVoices } from './AzureVoices';
import { ErrorNote, Group, Help, Screen } from './kit';
import { space } from './theme';

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
  const { label, gender } = slotInfo(slot);
  const [chosen, setChosen] = useState<string>();
  const [error, setError] = useState<string>();
  const azure = useAzureVoices(api, language);
  const sample = useAzureSample(api);

  const choose = async (voice: string) => {
    const before = chosen;
    setChosen(voice);
    setError(undefined);
    sample.play(sampleLine(language, gender), voice);
    try {
      onSettings(await api.updateSettings({ voices: { [language]: { [slot]: voice } } }));
    } catch (e) {
      setChosen(before);
      setError(failureText(e, { what: "Couldn't save the voice.", next: 'Try again.' }));
    }
  };

  const options = azure.voices ? voicesForSlot(azure.voices, slot) : undefined;

  return (
    <Screen title={label}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {sample.error ? <ErrorNote message={sample.error} /> : null}
        {options ? (
          <Group accessibilityRole="radiogroup">
            <AzureVoiceRows voices={options} selected={chosen ?? selected} onChoose={(v) => { if (v) choose(v.voice); }} />
          </Group>
        ) : null}
        {options && options.length === 0 ? <Help>{`Azure lists no ${gender === 'male' ? "men's" : "women's"} voices in ${LANGUAGES[language].name}.`}</Help> : null}
        <Help>{`Choosing a voice plays a line in it. Only ${gender === 'male' ? "men's" : "women's"} voices are listed here.`}</Help>
      </ScrollView>
    </Screen>
  );
}
