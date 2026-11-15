import React, { useState } from 'react';
import { ActivityIndicator, ScrollView } from 'react-native';
import { azureVoiceName } from '../core/voices';
import type { Api, AzureVoice } from '../reader/api';
import { saveNarrator } from '../reader/lessonStorage';
import { sampleLine } from '../reader/voiceSlots';
import { AzureVoiceRows, useAzureSample, useAzureVoices } from './AzureVoices';
import { ErrorNote, Group, Help, Screen } from './kit';
import { space, useTheme, readable } from './theme';

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
  const [chosen, setChosen] = useState<string>(current);
  const azure = useAzureVoices(api, 'en');
  const sample = useAzureSample(api);

  const choose = (picked: AzureVoice | undefined) => {
    const voice = picked?.voice ?? '';
    setChosen(voice);
    saveNarrator(voice);
    sample.play(sampleLine('en', 'male'), voice || serverDefault || 'en-US-GuyNeural', 'en');
  };

  return (
    <Screen title="Narrator">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {sample.error ? <ErrorNote message={sample.error} /> : null}
        {!azure.voices && !azure.error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {azure.voices ? (
          <Group accessibilityRole="radiogroup">
            <AzureVoiceRows
              voices={azure.voices}
              selected={chosen || undefined}
              onChoose={choose}
              none={{ label: 'Default', hint: serverDefault ? azureVoiceName(serverDefault) : "The server's own voice" }}
            />
          </Group>
        ) : null}
        <Help>Choosing a voice plays a line in it. The narrator speaks the English in a lesson. It applies to lessons you make from now on.</Help>
      </ScrollView>
    </Screen>
  );
}
