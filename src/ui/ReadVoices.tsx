import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { ApiError, type Api, type Language, type Settings, type Speakers } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { AzureVoiceRows, useAzureSample, useAzureVoices } from './AzureVoices';
import { ErrorNote, Group, Help, Screen, SectionTitle } from './kit';
import { space } from './theme';

// A line for each language to hear a voice with.
const SAMPLES: Record<Language, string> = {
  th: 'สวัสดีครับ วันนี้อากาศดีนะครับ',
  es: 'Hola, ¿qué tal? Hoy hace muy buen día.',
  de: 'Hallo, wie geht es dir? Heute ist ein schöner Tag.',
  fr: 'Bonjour, comment ça va ? Il fait très beau aujourd’hui.',
  ru: 'Привет, как дела? Сегодня очень хорошая погода.',
  el: 'Γεια σου, τι κάνεις; Σήμερα έχει πολύ ωραίο καιρό.',
  pl: 'Cześć, co słychać? Dzisiaj jest bardzo ładna pogoda.',
  nb: 'Hei, hvordan går det? I dag er det veldig fint vær.',
};

const SPEAKERS: { key: keyof Speakers; title: string; hint: string }[] = [
  { key: 'A', title: 'Speaker A', hint: 'The first speaker in a dialogue, and the narrator of a story.' },
  { key: 'B', title: 'Speaker B', hint: 'The second speaker in a dialogue.' },
];

/**
 * The Azure voice each of a language's speakers is read in. The server keeps the choice; the texts
 * waiting to be read are recorded again in it, and a text already read keeps its audio.
 */
export function ReadVoices({ api, language, onSettings }: {
  api: Api;
  language: Language;
  /** The settings as the server has them after a change, for the rest of the app. */
  onSettings: (settings: Settings) => void;
}) {
  const name = LANGUAGES[language].name;
  const [speakers, setSpeakers] = useState<Speakers>();
  const [error, setError] = useState<string>();
  const azure = useAzureVoices(api, language);
  const sample = useAzureSample(api);

  useEffect(() => {
    let live = true;
    api.settings().then(
      (s) => {
        if (!live) return;
        // A server not yet updated sends no voices: say so rather than show an empty screen.
        if (s.voices?.[language]) setSpeakers(s.voices[language]);
        else setError("Read & Listen's server doesn't offer a choice of voices yet. It updates itself within about 15 minutes of an update; try again then.");
      },
      (e) => { if (live) setError(e instanceof ApiError ? e.message : String(e)); },
    );
    return () => { live = false; };
  }, [api, language]);

  const choose = async (speaker: keyof Speakers, voice: string) => {
    const before = speakers;
    setSpeakers((s) => (s ? { ...s, [speaker]: voice } : s));
    setError(undefined);
    sample.play(SAMPLES[language], voice);
    try {
      const saved = await api.updateSettings({ voices: { [language]: { [speaker]: voice } } });
      setSpeakers(saved.voices[language]);
      onSettings(saved);
    } catch (e) {
      setSpeakers(before);
      setError(e instanceof ApiError ? e.message : `Couldn't save the voice. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Screen title={`${name} voices`}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {sample.error ? <ErrorNote message={sample.error} /> : null}
        {azure.voices && speakers ? SPEAKERS.map((s) => (
          <React.Fragment key={s.key}>
            <SectionTitle>{s.title}</SectionTitle>
            <Group accessibilityRole="radiogroup">
              <AzureVoiceRows voices={azure.voices!} selected={speakers[s.key]} onChoose={(v) => { if (v) choose(s.key, v.voice); }} />
            </Group>
            <Help>{s.hint}</Help>
          </React.Fragment>
        )) : null}
        <Help>
          {`Choosing a voice plays a line in it. Texts waiting to be read are recorded again in the new voices; a text you've already read keeps its audio.`}
        </Help>
      </ScrollView>
    </Screen>
  );
}
