import { useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import {
  ApiError, type Api, type DifficultyLevel, type Progress, type Settings, type SettingsChange, type StretchWords,
} from '../../reader/api';
import { LEVEL_HELP, LEVEL_OPTIONS, levelOf } from '../../reader/difficulty';
import { grammarSummary } from '../../reader/grammar';
import { LANGUAGES } from '../../reader/languages';
import { DEFAULT_REGISTER, REGISTER_LEVELS, type RegisterLevel } from '../../reader/registerLevel';
import { describeProgress } from '../../reader/progress';
import { voicesSummary } from '../../reader/voiceSlots';
import { Card, ErrorNote, Group, Help, Loading, NavRow, Screen, Section, SECTION_GAP, Segments, Select } from '../kit';
import { CommonWords } from './ReadCommonWords';
import { space, type, useTheme, readable } from '../theme';

/** The card a change was made in, where its failure is shown. */
type FailureArea = 'words' | 'stretch' | 'difficulty' | 'register';

/**
 * One language's Read & Listen settings, the ones set once and rarely changed
 * (docs/read-and-listen/architecture.md, Shelf): its deck, common words, voices and grammar,
 * practice words, text difficulty, and how reading is going.
 * Opened from the shelf's gear button; the language is the one the shelf is showing.
 */
export function ReadLanguage({ api, deckNames, onSettings, onVoices, onGrammar, onVocabCheck }: {
  api: Api;
  /** Franki's decks, to choose the language's deck from. */
  deckNames: string[];
  /** The settings as the server has them, each time they load or change. */
  onSettings: (settings: Settings) => void;
  onVoices: () => void;
  onGrammar: () => void;
  /** The vocabulary check, which suggests the common-words setting. */
  onVocabCheck: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [grammar, setGrammar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A change that failed, shown in the card it was made in rather than at the top, out of sight.
  const [failed, setFailed] = useState<{ at: FailureArea; message: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.settings();
      setSettings(s);
      onSettings(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load these settings.");
    }
    api.progress().then(setProgress, () => undefined);
    api.grammar().then((g) => setGrammar(grammarSummary(g.points)), () => undefined);
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps -- onSettings is the app's setter
  // Not only on mount: the vocabulary check (and the voices and grammar screens) open on top of this
  // one, so a setting they change is only known to the server until this asks again.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Each change is numbered, so only the latest one's answer (or failure) is shown.
  const settingSeq = useRef(0);
  const change = async (update: SettingsChange, at: FailureArea) => {
    if (!settings) return;
    const before = settings;
    const mine = ++settingSeq.current;
    setSettings({ ...settings, ...update, decks: { ...settings.decks, ...update.decks }, voices: settings.voices, cast: settings.cast, common: { ...settings.common, ...update.common } });
    setFailed(null);
    try {
      const saved = await api.updateSettings(update);
      if (mine !== settingSeq.current) return;
      setSettings(saved);
      onSettings(saved);
    } catch (e) {
      if (mine !== settingSeq.current) return;
      setSettings(before);
      setFailed({ at, message: e instanceof ApiError ? e.message : "Couldn't change that setting. Try again." });
    }
  };

  // Text difficulty, from the next text written. The answer is the target new texts are written at.
  const chooseDifficulty = async (level: DifficultyLevel) => {
    if (!progress || levelOf(progress.next.floor) === level) return;
    setFailed(null);
    try {
      const next = await api.setDifficulty(level);
      setProgress((p) => (p ? { ...p, next } : p));
    } catch (e) {
      setFailed({ at: 'difficulty', message: e instanceof ApiError ? e.message : "Couldn't change the text difficulty. Try again." });
    }
  };

  const language = settings?.language;
  const name = language ? LANGUAGES[language].name : '';
  const voices = language ? settings?.voices?.[language] : undefined;
  const failure = (at: FailureArea) => (failed?.at === at ? <ErrorNote message={failed.message} /> : null);

  return (
    <Screen title={name ? `${name} settings` : 'Settings'}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: SECTION_GAP }}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {!settings && !error ? <Loading /> : null}

        {settings && language ? (
          <>
            <Section
              title="Words and voices"
            >
              <Card>
                {/* `decks` is missing from a server older than the deck setting. */}
                {settings.decks ? (
                  <>
                    <Select
                      label="Deck"
                      options={deckNames.includes(settings.decks[language]) ? deckNames : [settings.decks[language], ...deckNames]}
                      value={settings.decks[language]}
                      onChange={(deck) => change({ decks: { [language]: deck } }, 'words')}
                    />
                    <Help>Words come from this deck and its subdecks. Texts already waiting were written from the old one.</Help>
                  </>
                ) : null}
                <CommonWords settings={settings} onChange={(count) => change({ common: { [language]: count } }, 'words')} />
                {failure('words')}
              </Card>
              <Group>
                {/* Thai counts only its deck, so it has no common words to check. */}
                {settings.common?.[language] !== undefined ? (
                  <NavRow first label="Vocabulary check" detail="20 questions to see how many common words you know" onPress={onVocabCheck} />
                ) : null}
                <NavRow first={settings.common?.[language] === undefined} label="Voices" detail={voicesSummary(voices) ?? 'The voices texts are read in'} onPress={onVoices} />
                <NavRow label="Grammar" detail={grammar ?? 'Practice or avoid'} onPress={onGrammar} />
              </Group>
            </Section>

            <Section
              title="Practice words"
            >
              <Card>
                <Segments<StretchWords>
                  options={[{ value: 'topic', label: 'Fit the text' }, { value: 'any', label: 'Any word' }]}
                  value={settings.stretch_words}
                  onChange={(stretch_words) => change({ stretch_words }, 'stretch')}
                />
                {failure('stretch')}
                <Help>
                  {settings.stretch_words === 'topic'
                    ? 'Picked from your newer cards and the ones you reviewed today, to fit each text. A card due today is used only after you review it.'
                    : "Any of your newer cards and the ones you reviewed today, even ones that don't fit the text. A card due today is used only after you review it. Applies to texts written from now on."}
                </Help>
              </Card>
            </Section>

            <Section
              title="Register"
            >
              <Card>
                <Segments<RegisterLevel>
                  options={REGISTER_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
                  value={settings.register ?? DEFAULT_REGISTER}
                  onChange={(register) => change({ register }, 'register')}
                />
                {failure('register')}
                <Help>
                  {`${REGISTER_LEVELS.find((l) => l.value === (settings.register ?? DEFAULT_REGISTER))!.help} Applies to the texts, lessons, talking points and scenes Claude writes from now on. A cram or a scene can choose its own.`}
                </Help>
              </Card>
            </Section>

            {progress ? (
              <>
                <Section
                  title="Text difficulty"
                >
                  <Card style={{ gap: space.s }}>
                    <Segments<DifficultyLevel>
                      options={LEVEL_OPTIONS}
                      value={levelOf(progress.next.floor)}
                      onChange={chooseDifficulty}
                    />
                    {failure('difficulty')}
                    <Help>{LEVEL_HELP}</Help>
                  </Card>
                </Section>
                <Section
                  title="Reading stats"
                >
                  <ProgressCard progress={progress} />
                </Section>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ProgressCard({ progress }: { progress: Progress }) {
  const c = useTheme();
  const { headline, detail, next } = describeProgress(progress);
  return (
    <Card style={{ gap: space.xs }}>
      <Text style={{ ...type.headline, color: c.text }}>{headline}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>{detail}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{next}</Text>
    </Card>
  );
}
