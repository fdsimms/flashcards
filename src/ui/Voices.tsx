import { Stack, useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useOutputWake } from './useOutputWake';
import { Alert, AppState, ScrollView } from 'react-native';
import {
  azureVoiceName, chosenVoice, deckLanguages, defaultRate, voiceQuality, voicesIn, VOICE_RATES,
  type DeckLanguage, type PhoneVoice, type VoiceChoice, type VoiceSettings,
} from '../core/voices';
import { failureText } from '../core/failure';
import { RECORDING_RATE } from '../core/recording';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import type { Api } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { searchVoices } from '../reader/voiceSlots';
import { AzureVoiceRows, AzureVoiceTerms, useAzureSample, useAzureVoices } from './AzureVoices';
import { CheckRow, EmptyState, ErrorNote, Group, Help, Loading, NavRow, Screen, Section, SECTION_GAP, Segments } from './kit';
import { NativeRecordingsSetting } from './NativeRecordingsSetting';
import { space, readable } from './theme';
import { stopSpeechIfRunning } from './usePhoneSpeech';

const DOWNLOAD_HELP =
  'To download more iPhone voices, open Settings, Accessibility, Spoken Content, Voices. ' +
  "Enhanced and Premium voices sound the most natural. Other apps can't use Siri's voices.";

/**
 * What both voice screens show: the decks' languages, the phone's voices and the choices saved.
 * The phone's voices are read again whenever the screen comes back into view or the app comes
 * back from the background, so a voice just downloaded in iOS Settings shows up.
 */
/** The repo these screens use: the voice choices live in SQLite, and an Azure voice is copied to the Anki collection for the MCP. */
type VoicesRepo = Repo & Pick<AnkiLink, 'setAnkiAudioVoice' | 'ankiNativeRecordings' | 'setAnkiNativeRecordings'>;

function useVoiceChoices(repo: VoicesRepo) {
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
    // The Azure voice is also kept in the Anki collection, where the MCP reads it, so a note it adds is
    // recorded with this voice too. The phone's choice stands either way, so a failure is said, not undone.
    if ('azureVoice' in change) {
      try {
        await repo.setAnkiAudioVoice(key, change.azureVoice ? { voice: change.azureVoice, rate: RECORDING_RATE } : null);
      } catch (e) {
        Alert.alert('Voice saved on this phone only', failureText(e, {
          what: "Couldn't copy it to your Anki collection, so notes Claude adds may be recorded with another voice.",
          next: 'Choose the voice again to retry.',
        }));
      }
    }
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
export function Voices({ repo, onLanguage }: { repo: VoicesRepo; onLanguage: (key: string) => void }) {
  const { languages, voices, settings, error, retry } = useVoiceChoices(repo);
  return (
    <Screen title="Voices">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section
          footer={(
            <>
              <Help>
                Each language has an Azure voice and an iPhone voice. Cards with a recording play it. Cards without one
                are read by the iPhone voice, and new notes are recorded with the Azure voice.
              </Help>
              <Help>{DOWNLOAD_HELP}</Help>
            </>
          )}
        >
          {languages?.length ? (
            <Group>
              {languages.map((l, i) => (
                <NavRow key={l.key} first={i === 0} label={l.name} facts={summary(l, voices, settings)} onPress={() => onLanguage(l.key)} />
              ))}
            </Group>
          ) : languages ? (
            <EmptyState icon="speaker.wave.2" title="No decks are read aloud yet" body="A deck shows up here once its notes have a Language, or its card template reads them aloud with Anki's tts filter." />
          ) : error ? (
            <ErrorNote message={error} onRetry={retry} />
          ) : <Loading />}
        </Section>
        {languages?.length ? <NativeRecordingsSetting repo={repo} languages={languages.filter((l) => l.key in LANGUAGES)} /> : null}
      </ScrollView>
    </Screen>
  );
}

/**
 * One language's voices: the Azure voice its cards are recorded with (while Read & Listen is on,
 * since its server holds the Azure key), and the iPhone voice and speed. Choosing any of them
 * reads a word from the decks with it.
 */
export function VoiceLanguage({ repo, api, languageKey }: { repo: VoicesRepo; api: Api | null; languageKey: string }) {
  const { languages, voices, settings, choose, error, retry } = useVoiceChoices(repo);
  const lang = languages?.find((l) => l.key === languageKey);
  const azure = useAzureVoices(api, lang?.key);
  const sample = useAzureSample(api);
  // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake).
  const wake = useOutputWake();
  const [query, setQuery] = useState('');
  if (!lang) {
    return (
      <Screen title="">
        {languages ? (
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
            <EmptyState icon="speaker.slash" title="No deck is read aloud in this language anymore" />
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
    const v = voices.find((x) => x.identifier === voice);
    void stopSpeechIfRunning().then(wake).then(() => Speech.speak(lang.sample ?? lang.name, { language: v?.language ?? lang.lang, voice, rate: speed }));
  };

  return (
    <Screen title={lang.name}>
      {api ? <Stack.SearchBar placeholder="Search Azure voices" autoCapitalize="none" onChangeText={(e) => setQuery(e.nativeEvent.text)} /> : null}
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: SECTION_GAP }}>
        <Section title="Recordings">
          {!api ? (
            <Help>Recording cards with Azure voices uses Read & Listen. Turn it on in Settings, Read & Listen.</Help>
          ) : azure.error ? (
            <ErrorNote message={azure.error} onRetry={azure.retry} />
          ) : !azure.voices ? (
            <Loading />
          ) : (
            <>
              <Group accessibilityRole="radiogroup">
                <AzureVoiceRows
                  voices={searchVoices(azure.voices, query)}
                  selected={choice?.azureVoice}
                  none={query.trim() ? undefined : { label: 'No Azure voice', hint: 'Notes aren\'t recorded. Cards without audio are read aloud with the iPhone voice below' }}
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
                {`New ${lang.name} notes are recorded in this voice. To record existing ones, use Record audio in the note editor or the deck's options. Only Omnilanguage notes are recorded.`}
              </Help>
            </>
          )}
        </Section>
        <Section title="iPhone voice speed">
          <Segments
            options={VOICE_RATES.map((r) => ({ value: r, label: `${r.toFixed(1)}×`, accessibilityLabel: `Speed ${r}` }))}
            value={rate}
            onChange={(r) => { listen(current, r); choose(lang.key, { rate: r }); }}
          />
        </Section>
        <Section
          title="iPhone voice"
          footer={(
            <>
              {inLanguage.length ? null : <Help>{`This iPhone has no ${lang.name} voice yet.`}</Help>}
              <Help>{`Choosing a voice or speed plays a sample. ${DOWNLOAD_HELP}`}</Help>
            </>
          )}
        >
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
        </Section>
      </ScrollView>
    </Screen>
  );
}
