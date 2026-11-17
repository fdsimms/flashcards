import { Stack, useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, ScrollView } from 'react-native';
import {
  azureVoiceName, chosenVoice, deckLanguages, defaultRate, voiceQuality, voicesIn, VOICE_RATES,
  type DeckLanguage, type PhoneVoice, type VoiceChoice, type VoiceSettings,
} from '../core/voices';
import { failureText } from '../core/failure';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { searchVoices } from '../reader/voiceSlots';
import { AzureVoiceRows, AzureVoiceTerms, useAzureSample, useAzureVoices } from './AzureVoices';
import { CheckRow, ErrorNote, Group, Help, Loading, NavRow, Screen, SectionTitle, Segments } from './kit';
import { space, useTheme, readable } from './theme';

const DOWNLOAD_HELP =
  'To download more iPhone voices, open Settings, Accessibility, Spoken Content, Voices. ' +
  "Enhanced and Premium voices sound the most natural. Other apps can't use Siri's voices.";

/**
 * What both voice screens show: the decks' languages, the phone's voices and the choices saved.
 * The phone's voices are read again whenever the screen comes back into view or the app comes
 * back from the background, so a voice just downloaded in iOS Settings shows up.
 */
function useVoiceChoices(repo: Repo) {
  const [languages, setLanguages] = useState<DeckLanguage[]>();
  const [voices, setVoices] = useState<PhoneVoice[]>([]);
  const [settings, setSettings] = useState<VoiceSettings>({});
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<VoiceSettings>({});

  const loadVoices = useCallback(() => { Speech.getAvailableVoicesAsync().then(setVoices).catch(() => {}); }, []);
  useFocusEffect(loadVoices);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') loadVoices(); });
    return () => sub.remove();
  }, [loadVoices]);

  useFocusEffect(useCallback(() => {
    let live = true;
    setError(null);
    (async () => {
      const [notes, types, saved] = await Promise.all([repo.listNotes(), repo.listNoteTypes(), repo.voiceSettings()]);
      if (!live) return;
      latest.current = saved;
      setSettings(saved);
      setLanguages(deckLanguages(notes, types.values(), saved));
    })().catch((e) => { if (live) setError(failureText(e, { what: "Couldn't load the voices.", next: 'Try again.' })); });
    return () => { live = false; Speech.stop(); };
  }, [repo, attempt]));

  /** Saves a language's choice (to SQLite first, then the screen), built on the last one saved. */
  const choose = useCallback(async (key: string, change: Partial<VoiceChoice>) => {
    const before = latest.current;
    const next = { ...before, [key]: { ...before[key], ...change } };
    latest.current = next;
    try {
      await repo.saveVoiceSettings(next);
    } catch (e) {
      latest.current = before;
      Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' }));
      return;
    }
    setSettings(next);
  }, [repo]);

  return { languages, voices, settings, choose, error, retry: () => setAttempt((n) => n + 1) };
}

/** What a language's row says: the Azure voice cards are recorded with, and the iPhone's voice and speed. */
function summary(lang: DeckLanguage, voices: PhoneVoice[], settings: VoiceSettings): { label: string; value: string }[] {
  const choice = settings[lang.key];
  const id = chosenVoice(voices, settings, lang.key);
  const rate = `${(choice?.rate ?? defaultRate(lang)).toFixed(1)}×`;
  const azure = choice?.azureVoice ? [{ label: 'Azure', value: azureVoiceName(choice.azureVoice) }] : [];
  const iphone = (value: string) => [...azure, { label: 'iPhone', value }];
  if (id) return iphone(`${voices.find((v) => v.identifier === id)?.name ?? id}, ${rate}`);
  if (choice?.voice) return iphone(`${choice.voiceName ?? 'The chosen voice'} isn't on this iPhone. Automatic, ${rate}`);
  return iphone(`Automatic, ${rate}`);
}

/** Settings > Voices: each language the decks are read aloud in, with its voice and speed. */
export function Voices({ repo, onLanguage }: { repo: Repo; onLanguage: (key: string) => void }) {
  const c = useTheme();
  const { languages, voices, settings, error, retry } = useVoiceChoices(repo);
  return (
    <Screen title="Voices">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {languages?.length ? (
          <Group>
            {languages.map((l, i) => (
              <NavRow key={l.key} first={i === 0} label={l.name} facts={summary(l, voices, settings)} onPress={() => onLanguage(l.key)} />
            ))}
          </Group>
        ) : languages ? (
          <Help>None of your decks are read aloud yet. Omnilanguage notes with a Language, and note types whose templates use Anki's tts filter, show up here.</Help>
        ) : error ? (
          <ErrorNote message={error} onRetry={retry} />
        ) : <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} />}
        <Help>
          Each language has an Azure voice and an iPhone voice. A card with a recording plays it. A card without one
          is read by the iPhone voice, and the Azure voice is used to record it. If an Anki template's tts filter
          names a voice or speed, that is used instead of the iPhone's.
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
  const c = useTheme();
  const { languages, voices, settings, choose, error, retry } = useVoiceChoices(repo);
  const lang = languages?.find((l) => l.key === languageKey);
  const azure = useAzureVoices(api, lang?.key);
  const sample = useAzureSample(api);
  const [query, setQuery] = useState('');
  if (!lang) {
    return (
      <Screen title="">
        {languages ? (
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
            <Help>No deck is read aloud in this language anymore.</Help>
          </ScrollView>
        ) : <Loading error={error} onRetry={retry} />}
      </Screen>
    );
  }

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
      {api ? <Stack.SearchBar placeholder="Search Azure voices" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} /> : null}
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        <SectionTitle>Recordings</SectionTitle>
        {!api ? (
          <Help>Recording cards with Azure's voices needs Read & Listen turned on (Settings, Read & Listen), since its server holds the Azure key.</Help>
        ) : azure.error ? (
          <ErrorNote message={azure.error} onRetry={azure.retry} />
        ) : !azure.voices ? (
          <ActivityIndicator color={c.accent} style={{ marginVertical: space.l }} />
        ) : (
          <>
            <Group accessibilityRole="radiogroup">
              <AzureVoiceRows
                voices={searchVoices(azure.voices, query)}
                selected={choice?.azureVoice}
                none={query.trim() ? undefined : { label: 'Don\'t record', hint: 'Cards without a recording are read with the iPhone voice below' }}
                onChoose={(v) => {
                  if (v) sample.play(lang.sample ?? lang.name, v.voice, lang.sample ? lang.lang : undefined);
                  choose(lang.key, { azureVoice: v?.voice });
                }}
              />
            </Group>
            {query.trim() && !searchVoices(azure.voices, query).length ? <Help>{`No Azure voices match "${query.trim()}".`}</Help> : null}
            {sample.error ? <ErrorNote message={sample.error} /> : null}
            <AzureVoiceTerms voices={azure.voices} />
            <Help>
              {`${lang.name} notes without a recording get one in this voice: when a note is added, from Record audio in the note editor, and for a whole deck from its options. Read & Listen's server records it, and it goes to Anki with the note at the next sync. Only Omnilanguage notes are recorded, from their Entry.`}
            </Help>
          </>
        )}
        <SectionTitle>iPhone voice speed</SectionTitle>
        <Segments
          options={VOICE_RATES.map((r) => ({ value: r, label: `${r.toFixed(1)}×`, accessibilityLabel: `Speed ${r}` }))}
          value={rate}
          onChange={(r) => { listen(current, r); choose(lang.key, { rate: r }); }}
        />
        <SectionTitle>iPhone voice</SectionTitle>
        {choice?.voice && !current ? (
          <Help>{`${choice.voiceName ?? 'The voice chosen before'} isn't on this iPhone anymore, so iOS picks one. Download it again or choose another.`}</Help>
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
