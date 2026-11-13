import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import {
  ApiError, type Api, type Progress, type Settings, type SettingsChange, type Shelf, type StretchWords,
} from '../reader/api';
import { grammarSummary } from '../reader/grammar';
import { LANGUAGES } from '../reader/languages';
import { describeProgress } from '../reader/progress';
import { voicesSummary } from '../reader/voiceSlots';
import { haptic } from './haptics';
import { Button, Card, ErrorNote, Field, Group, Help, Icon, NavRow, Screen, SectionTitle, Segments, Select, Tappable } from './kit';
import { CommonWords } from './ReadCommonWords';
import { radius, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * One language's Read & Listen settings, the ones set once and rarely changed
 * (docs/read-and-listen/architecture.md, Shelf): its deck, common words, voices and grammar, the
 * ongoing story, the themes the shelf writes from, practice words, and how reading is going.
 * Opened from the shelf's sliders button; the language is the one the shelf is showing.
 */
export function ReadLanguage({ api, deckNames, onSettings, onVoices, onGrammar, onVocabCheck, onEpisodes }: {
  api: Api;
  /** Franki's decks, to choose the language's deck from. */
  deckNames: string[];
  /** The settings as the server has them, each time they load or change. */
  onSettings: (settings: Settings) => void;
  onVoices: () => void;
  onGrammar: () => void;
  /** The vocabulary check, which suggests the common-words setting. */
  onVocabCheck: () => void;
  /** Lists the story's episodes, to read again from the first. */
  onEpisodes: (storyId: number) => void;
}) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [grammar, setGrammar] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState('');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, sh] = await Promise.all([api.settings(), api.shelf()]);
      setSettings(s);
      onSettings(s);
      setShelf(sh);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load these settings.");
    }
    api.progress().then(setProgress, () => undefined);
    api.grammar().then((g) => setGrammar(grammarSummary(g.points)), () => undefined);
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps -- onSettings is the app's setter
  useEffect(() => { load(); }, [load]);

  // Each change is numbered, so only the latest one's answer (or failure) is shown.
  const settingSeq = useRef(0);
  const change = async (update: SettingsChange) => {
    if (!settings) return;
    const before = settings;
    const mine = ++settingSeq.current;
    setSettings({ ...settings, ...update, decks: { ...settings.decks, ...update.decks }, voices: settings.voices, common: { ...settings.common, ...update.common } });
    setError(null);
    try {
      const saved = await api.updateSettings(update);
      if (mine !== settingSeq.current) return;
      setSettings(saved);
      onSettings(saved);
    } catch (e) {
      if (mine !== settingSeq.current) return;
      setSettings(before);
      setError(e instanceof ApiError ? e.message : "Couldn't change that setting. Try again.");
    }
  };

  const unlike = async (id: number) => {
    setShelf((s) => (s ? { ...s, themes: s.themes.filter((t) => t.id !== id) } : s));
    try {
      await api.setFavorite(id, false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove that theme. Try again.");
      load();
    }
  };

  const startStory = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      await api.startStory(about.trim());
      setAbout('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a story. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const confirmNewStory = () => {
    if (!shelf?.story) { startStory(); return; }
    Alert.alert('Start a new story?', `${shelf.story.title || 'Your story'} stops here. Its episodes stay in Past texts.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start a new story', onPress: startStory },
    ]);
  };

  const language = settings?.language;
  const name = language ? LANGUAGES[language].name : '';
  const story = shelf?.story ?? null;
  const voices = language ? settings?.voices?.[language] : undefined;

  return (
    <Screen title={name ? `${name} settings` : 'Settings'}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {!settings && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}

        {settings && language ? (
          <>
            <SectionTitle>Words and voices</SectionTitle>
            <Card>
              {/* `decks` is missing from a server older than the deck setting. */}
              {settings.decks ? (
                <>
                  <Select
                    label="Deck"
                    options={deckNames.includes(settings.decks[language]) ? deckNames : [settings.decks[language], ...deckNames]}
                    value={settings.decks[language]}
                    onChange={(deck) => change({ decks: { [language]: deck } })}
                  />
                  <Help>Words come from this deck and its subdecks. Texts already waiting were written from the old one.</Help>
                </>
              ) : null}
              <CommonWords settings={settings} onChange={(count) => change({ common: { [language]: count } })} />
            </Card>
            <Group>
              {/* Thai counts only its deck, so it has no common words to check. */}
              {settings.common?.[language] !== undefined ? (
                <NavRow first label="Vocabulary check" detail="20 questions to find how many common words to count" onPress={onVocabCheck} />
              ) : null}
              <NavRow first={settings.common?.[language] === undefined} label="Voices" detail={voicesSummary(voices) ?? 'The voices texts are read in'} onPress={onVoices} />
              <NavRow label="Grammar" detail={grammar ?? 'Practice or avoid'} onPress={onGrammar} />
            </Group>

            <SectionTitle>The story</SectionTitle>
            <Card>
              {story ? (
                <View style={{ gap: space.xs }}>
                  <Text style={{ ...type.headline, color: c.text }}>{story.title || 'Your story'}</Text>
                  <Help>{`${story.read} ${story.read === 1 ? 'episode' : 'episodes'} read${story.about ? `. About ${story.about}` : ''}.`}</Help>
                </View>
              ) : (
                <Help>No story yet. Start one here or on the shelf.</Help>
              )}
              {story && story.read > 0 ? <Button label="Read from the start" variant="secondary" onPress={() => onEpisodes(story.id)} /> : null}
              <Field label={story ? 'A new story about' : 'A story about'} placeholder="Leave empty to let the writer choose" value={about} onChangeText={setAbout} />
              <Button label="Start a new story" variant="secondary" onPress={confirmNewStory} busy={starting} />
              <Help>A new story keeps the same people and places from one episode to the next.</Help>
            </Card>

            <SectionTitle>Themes you like</SectionTitle>
            <Card>
              {shelf && shelf.themes.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {shelf.themes.map((t) => (
                    <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingLeft: space.m, borderRadius: radius.pill, backgroundColor: c.fill }}>
                      <Text style={{ ...type.subhead, color: c.text }}>{t.name}</Text>
                      <Tappable
                        onPress={() => { haptic.tap(); unlike(t.id); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${t.name}`}
                        hitSlop={{ top: 6, bottom: 6, right: 6 }}
                        style={{ width: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon name="xmark" size={12} color={c.textSecondary} weight="semibold" />
                      </Tappable>
                    </View>
                  ))}
                </View>
              ) : (
                <Help>None yet.</Help>
              )}
              <Help>More like this, at the end of a text or on a text held down, adds its theme. The shelf writes from these, today's due words, and new ideas. Themes are shared by every language.</Help>
            </Card>

            <SectionTitle>Practice words</SectionTitle>
            <Card>
              <Segments<StretchWords>
                options={[{ value: 'topic', label: 'Fit the text' }, { value: 'any', label: 'Any due word' }]}
                value={settings.stretch_words}
                onChange={(stretch_words) => change({ stretch_words })}
              />
              <Help>
                {settings.stretch_words === 'topic'
                  ? 'Picked from your due and newer cards to fit each text. One text on the shelf always uses words due today.'
                  : "Any of your due and newer cards, even ones that don't fit the text. Applies from the next text written."}
              </Help>
            </Card>

            {progress ? (
              <>
                <SectionTitle>Reading stats</SectionTitle>
                <ProgressCard progress={progress} />
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
