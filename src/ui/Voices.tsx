import { useFocusEffect } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView } from 'react-native';
import {
  chosenVoice, deckLanguages, defaultRate, voiceQuality, voicesIn, VOICE_RATES,
  type DeckLanguage, type PhoneVoice, type VoiceChoice, type VoiceSettings,
} from '../core/voices';
import type { Repo } from '../db/repo';
import { CheckRow, Group, Help, NavRow, Screen, SectionTitle, Segments } from './kit';
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

/** What a language's row says: the voice and speed it's read with. */
function summary(lang: DeckLanguage, voices: PhoneVoice[], settings: VoiceSettings): string {
  const choice = settings[lang.key];
  const id = chosenVoice(voices, settings, lang.key);
  const rate = `${(choice?.rate ?? defaultRate(lang)).toFixed(1)}×`;
  if (id) return `${voices.find((v) => v.identifier === id)?.name ?? id}, ${rate}`;
  if (choice?.voice) return `${choice.voiceName ?? 'The chosen voice'} isn't on this iPhone. Automatic, ${rate}`;
  return `Automatic, ${rate}`;
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
          The voice and speed the phone reads each language with, when a card has no recording. A card with a
          recording plays it instead. A voice or speed named in an Anki template's tts filter is used before these.
        </Help>
        <Help>{DOWNLOAD_HELP}</Help>
      </ScrollView>
    </Screen>
  );
}

/** One language's voice and speed. Choosing either reads a word from the decks with it. */
export function VoiceLanguage({ repo, languageKey }: { repo: Repo; languageKey: string }) {
  const { languages, voices, settings, choose } = useVoiceChoices(repo);
  const lang = languages?.find((l) => l.key === languageKey);
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
        <SectionTitle>Speed</SectionTitle>
        <Segments
          options={VOICE_RATES.map((r) => ({ value: r, label: `${r.toFixed(1)}×`, accessibilityLabel: `Speed ${r}` }))}
          value={rate}
          onChange={(r) => { listen(current, r); choose(lang.key, { rate: r }); }}
        />
        <SectionTitle>Voice</SectionTitle>
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
