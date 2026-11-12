import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView } from 'react-native';
import {
  azureVoiceName, chosenVoice, deckLanguages, defaultRate, voiceQuality, voicesIn, VOICE_RATES,
  type DeckLanguage, type PhoneVoice, type VoiceChoice, type VoiceSettings,
} from '../core/voices';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { AzureVoiceRows, useAzureSample, useAzureVoices } from './AzureVoices';
import { CheckRow, ErrorNote, Group, Help, NavRow, Screen, SectionTitle, Segments } from './kit';
import { space } from './theme';

const DOWNLOAD_HELP =
  'More voices can be downloaded on iPhone in Settings > Accessibility > Spoken Content > Voices. ' +
  "Enhanced and Premium voices sound the most natural. Siri's voices can't be used by other apps.";

/**
 * What both voice screens show: the decks' languages, the phone's voices and the choices saved.
 * The phone's voices are read again whenever the screen comes back into view or the app comes
 * back from the background, so a voice just downloaded in iOS Settings shows up.
 */
function useVoiceChoices(repo: Repo) {
  const [languages, setLanguages] = useState<DeckLanguage[]>();
  const [voices, setVoices] = useState<PhoneVoice[]>([]);
  const [settings, setSettings] = useState<VoiceSettings>({});
  const latest = useRef<VoiceSettings>({});

  const loadVoices = useCallback(() => { Speech.getAvailableVoicesAsync().then(setVoices).catch(() => {}); }, []);
  useFocusEffect(loadVoices);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') loadVoices(); });
    return () => sub.remove();
  }, [loadVoices]);

  useFocusEffect(useCallback(() => {
    let live = true;
    (async () => {
      const [notes, types, saved] = await Promise.all([repo.listNotes(), repo.listNoteTypes(), repo.voiceSettings()]);
      if (!live) return;
      latest.current = saved;
      setSettings(saved);
      setLanguages(deckLanguages(notes, types.values(), saved));
    })();
    return () => { live = false; Speech.stop(); };
  }, [repo]));

  /** Saves a language's choice (to SQLite first, then the screen), built on the last one saved. */
  const choose = useCallback(async (key: string, change: Partial<VoiceChoice>) => {
    const next = { ...latest.current, [key]: { ...latest.current[key], ...change } };
    latest.current = next;
    await repo.saveVoiceSettings(next);
    setSettings(next);
  }, [repo]);

  return { languages, voices, settings, choose };
}

/** What a language's row says: the voice cards are recorded with, and the iPhone's voice and speed. */
function summary(lang: DeckLanguage, voices: PhoneVoice[], settings: VoiceSettings): string {
  const choice = settings[lang.key];
  const id = chosenVoice(voices, settings, lang.key);
  const rate = `${(choice?.rate ?? defaultRate(lang)).toFixed(1)}×`;
  const recorded = choice?.azureVoice ? `Recorded with ${azureVoiceName(choice.azureVoice)}. ` : '';
  if (id) return `${recorded}iPhone: ${voices.find((v) => v.identifier === id)?.name ?? id}, ${rate}`;
  if (choice?.voice) return `${recorded}iPhone: ${choice.voiceName ?? 'the chosen voice'} isn't on this iPhone. Automatic, ${rate}`;
  return `${recorded}iPhone: Automatic, ${rate}`;
}

/** Settings > Voices: each language the decks are read aloud in, with its voice and speed. */
export function Voices({ repo, onLanguage }: { repo: Repo; onLanguage: (key: string) => void }) {
  const { languages, voices, settings } = useVoiceChoices(repo);
  return (
    <Screen title="Voices">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {languages?.length ? (
          <Group>
            {languages.map((l, i) => (
              <NavRow key={l.key} first={i === 0} label={l.name} detail={summary(l, voices, settings)} onPress={() => onLanguage(l.key)} />
            ))}
          </Group>
        ) : languages ? (
          <Help>None of your decks are read aloud yet. Omnilanguage notes with a Language, and note types whose templates use Anki's tts filter, show up here.</Help>
        ) : null}
        <Help>
          For each language: the Azure voice cards without a recording are recorded with, and the iPhone voice and
          speed that read a card until it has one. A card with a recording plays it instead. A voice or speed named
          in an Anki template's tts filter is used before the iPhone's.
        </Help>
        <Help>{DOWNLOAD_HELP}</Help>
      </ScrollView>
    </Screen>
  );
}

/**
 * One language's voices: the Azure voice its cards are recorded with (while Read & Listen is on,
 * since its server holds the Azure key), and the iPhone voice and speed. Choosing any of them
 * reads a word from the decks with it.
 */
export function VoiceLanguage({ repo, api, languageKey }: { repo: Repo; api: Api | null; languageKey: string }) {
  const { languages, voices, settings, choose } = useVoiceChoices(repo);
  const lang = languages?.find((l) => l.key === languageKey);
  const azure = useAzureVoices(api, lang?.key);
  const sample = useAzureSample(api);
  if (!lang) return <Screen title="">{null}</Screen>;

  const choice = settings[lang.key];
  const current = chosenVoice(voices, settings, lang.key);
  const rate = choice?.rate ?? defaultRate(lang);
  const inLanguage = voicesIn(voices, lang.key);

  const listen = (voice: string | undefined, speed: number) => {
    Speech.stop();
    const v = voices.find((x) => x.identifier === voice);
    Speech.speak(lang.sample ?? lang.name, { language: v?.language ?? lang.lang, voice, rate: speed });
  };

  return (
    <Screen title={lang.name}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <SectionTitle>Recordings</SectionTitle>
        {!api ? (
          <Help>Recording cards with Azure's voices needs Read & Listen turned on (Settings, Read & Listen), since its server holds the Azure key.</Help>
        ) : azure.error ? (
          <ErrorNote message={azure.error} onRetry={azure.retry} />
        ) : azure.voices ? (
          <>
            <Group accessibilityRole="radiogroup">
              <AzureVoiceRows
                voices={azure.voices}
                selected={choice?.azureVoice}
                none={{ label: 'Don\'t record', hint: 'Cards without a recording are read with the iPhone voice below' }}
                onChoose={(v) => {
                  if (v) sample.play(lang.sample ?? lang.name, v.voice);
                  choose(lang.key, { azureVoice: v?.voice });
                }}
              />
            </Group>
            {sample.error ? <ErrorNote message={sample.error} /> : null}
            <Help>
              {`${lang.name} notes without a recording get one in this voice: when a note is added, from Record audio in the note editor, and for a whole deck from its options. Read & Listen's server records it, and it goes to Anki with the note at the next sync. Only Omnilanguage notes are recorded, from their Entry.`}
            </Help>
          </>
        ) : null}
        <SectionTitle>iPhone voice speed</SectionTitle>
        <Segments
          options={VOICE_RATES.map((r) => ({ value: r, label: `${r.toFixed(1)}×`, accessibilityLabel: `Speed ${r}` }))}
          value={rate}
          onChange={(r) => { listen(current, r); choose(lang.key, { rate: r }); }}
        />
        <SectionTitle>iPhone voice</SectionTitle>
        {choice?.voice && !current ? (
          <Help>{`${choice.voiceName ?? 'The voice chosen before'} isn't on this iPhone any more, so iOS picks one. Download it again or choose another.`}</Help>
        ) : null}
        <Group accessibilityRole="radiogroup">
          <CheckRow
            first
            label="Automatic"
            hint={`iOS picks its voice for ${lang.name}`}
            selected={!current}
            onPress={() => { listen(undefined, rate); choose(lang.key, { voice: undefined, voiceName: undefined }); }}
          />
          {inLanguage.map((v) => (
            <CheckRow
              key={v.identifier}
              label={v.name}
              hint={`${voiceQuality(v)}, ${v.language}`}
              selected={current === v.identifier}
              onPress={() => { listen(v.identifier, rate); choose(lang.key, { voice: v.identifier, voiceName: v.name }); }}
            />
          ))}
        </Group>
        {inLanguage.length ? null : <Help>{`This iPhone has no ${lang.name} voice yet.`}</Help>}
        <Help>{`Choosing a voice or speed reads ${lang.sample ? `"${lang.sample}"` : 'a sample'} with it. ${DOWNLOAD_HELP}`}</Help>
      </ScrollView>
    </Screen>
  );
}
