import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { haptic } from './haptics';
import {
  ApiError, type Api, type Form, type Language, type Length, type Progress, type Settings, type SettingsChange, type StretchWords, type Suggestion,
  type Topic,
} from '../reader/api';
import { grammarSummary } from '../reader/grammar';
import { ideaPage } from '../reader/ideas';
import { LANGUAGE_ORDER, LANGUAGES } from '../reader/languages';
import { describeProgress } from '../reader/progress';
import { Button, Card, ErrorNote, Field, Group, HeaderAction, Help, Icon, NavRow, Screen, Segments, Select, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

/**
 * Read & Listen's home: the language, your topics (favorites keep a text ready), topic ideas, past
 * texts, marked words, grammar, and the settings new texts are written with
 * (docs/read-and-listen/architecture.md, Topics). Topics are shared by both languages; everything
 * else here is the chosen language's.
 */

// While a text is being written, check back this often.
const WRITING_POLL_MS = 10_000;

export function ReadTopics({ api, deckNames, practice, onSettings, onOpen, onWords, onPast, onGrammar }: {
  api: Api;
  /** Franki's decks, to choose each language's deck from. */
  deckNames: string[];
  /** Opened from Review's "Read a text with these words": the next topic opened practices them. */
  practice?: { language: Language; count: number; onCancel: () => void };
  /** The settings as the server has them, each time they load or change. */
  onSettings?: (settings: Settings) => void;
  onOpen: (topic: Topic) => void;
  onWords: () => void;
  onPast: () => void;
  onGrammar: () => void;
}) {
  const c = useTheme();
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [markedCount, setMarkedCount] = useState<number | null>(null);
  const [grammar, setGrammar] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Suggestion[]>([]);
  const [ideaPageIndex, setIdeaPageIndex] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);

  // Bumped when the language changes: a load started before it is the other language's, and is
  // dropped rather than shown (a quick Thai, Spanish, Thai could otherwise end on Spanish's).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const started = loadSeq.current;
    try {
      const loaded = await api.topics();
      if (started !== loadSeq.current) return;
      setTopics(loaded);
      setError(null);
    } catch (e) {
      if (started !== loadSeq.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your topics.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  // Loaded apart from the topics, and left out quietly if they fail.
  const loadExtras = useCallback(async () => {
    const started = loadSeq.current;
    const current = <T,>(set: (value: T) => void) => (value: T) => { if (started === loadSeq.current) set(value); };
    await Promise.all([
      api.progress().then(current(setProgress), () => undefined),
      api.markedWords().then((ws) => current(setMarkedCount)(ws.length), () => undefined),
      api.suggestions().then(current(setIdeas), () => undefined),
      api.grammar().then((g) => current(setGrammar)(grammarSummary(g.points)), () => undefined),
    ]);
  }, [api]);
  useEffect(() => { loadExtras(); }, [loadExtras]);

  // Loaded on its own, so the topics still show if this fails.
  // Each change is numbered, so only the latest one's answer (or failure) is shown.
  const settingSeq = useRef(0);
  useEffect(() => {
    const started = settingSeq.current;
    api.settings().then((loaded) => { if (started === settingSeq.current) setSettings(loaded); }, () => undefined);
  }, [api]);

  useEffect(() => { if (settings) onSettings?.(settings); }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Whether the server took the change. */
  const changeSetting = async (change: SettingsChange): Promise<boolean> => {
    const before = settings;
    const mine = ++settingSeq.current;
    // Voices are chosen on Read & Listen's settings screen, not here; the server's answer brings them.
    setSettings((s) => (s ? { ...s, ...change, decks: { ...s.decks, ...change.decks }, voices: s.voices } : s));
    setSettingError(null);
    try {
      const saved = await api.updateSettings(change);
      if (mine === settingSeq.current) setSettings(saved);
      return true;
    } catch (e) {
      if (mine !== settingSeq.current) return false;
      setSettings(before);
      setSettingError(e instanceof ApiError ? e.message : "Couldn't change that setting. Try again.");
      return false;
    }
  };

  const changeLanguage = async (language: Language) => {
    loadSeq.current++;
    if (await changeSetting({ language })) {
      setIdeaPageIndex(0);
      await Promise.all([load(), loadExtras()]);
    }
  };

  // Words just studied are in one language: switch to it, once, so the text is written in it.
  const switched = useRef(false);
  useEffect(() => {
    if (!practice || !settings || switched.current) return;
    switched.current = true;
    if (settings.language !== practice.language) changeLanguage(practice.language);
  }, [practice, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll only while the server says a text is being written; a failed write stops it.
  const writing = topics?.some((t) => t.state === 'writing') ?? false;
  useEffect(() => {
    if (!writing) return;
    const id = setInterval(load, WRITING_POLL_MS);
    return () => clearInterval(id);
  }, [writing, load]);

  // An idea opens straight away, as a topic that isn't a favorite, so trying one doesn't start a
  // queue of texts for it. Starring it afterwards does.
  const openIdea = async (name: string) => {
    if (opening) return;
    setOpening(name);
    setAddError(null);
    try {
      onOpen(await api.addTopic(name, false));
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "Couldn't open that topic. Try again.");
      setOpening(null);
    }
  };

  const add = async () => {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.addTopic(name);
      setNewName('');
      await load();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "Couldn't add that topic. Try again.");
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = (topic: Topic) => {
    Alert.alert(`Remove ${topic.name}?`, 'It leaves your list. Adding a topic with the same name brings it back.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(topic) },
    ]);
  };

  const remove = async (topic: Topic) => {
    setTopics((ts) => ts?.filter((t) => t.id !== topic.id) ?? ts);
    try {
      await api.removeTopic(topic.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove that topic.");
    }
    await load();
  };

  const toggleFavorite = async (topic: Topic) => {
    try {
      await api.setFavorite(topic.id, !topic.favorite);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change that topic.");
    }
  };

  const favorites = topics?.filter((t) => t.favorite) ?? [];
  const others = topics?.filter((t) => !t.favorite) ?? [];
  const language = settings?.language ?? 'th';

  return (
    <Screen title="Read & Listen">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => {
            setRefreshing(true);
            await Promise.all([load(), loadExtras()]);
            setRefreshing(false);
          }} />
        }
      >
        {practice ? (
          <Card style={{ gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text }}>{`Practice the ${practice.count} ${practice.count === 1 ? 'word' : 'words'} you just studied`}</Text>
            <Help>Pick a topic, or an idea below. The text uses as many of those words as fit it.</Help>
            <View style={{ alignItems: 'flex-start' }}><HeaderAction label="Cancel" onPress={practice.onCancel} /></View>
          </Card>
        ) : null}
        <Help>{`Pick a topic. Texts use words from your ${LANGUAGES[language].name} deck.`}</Help>
        {settings ? (
          <Segments<Language>
            options={LANGUAGE_ORDER.map((code) => ({ value: code, label: LANGUAGES[code].name }))}
            value={settings.language}
            onChange={changeLanguage}
          />
        ) : null}

        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {topics === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}

        {progress ? <ProgressCard progress={progress} /> : null}

        {favorites.length > 0 ? (
          <TopicList title="Favorites" topics={favorites} onOpen={onOpen} onStar={toggleFavorite} onRemove={confirmRemove} />
        ) : null}
        {others.length > 0 ? (
          <TopicList title="Other topics" topics={others} onOpen={onOpen} onStar={toggleFavorite} onRemove={confirmRemove}
            help="Opening a topic with no text ready takes about half a minute." />
        ) : null}
        {topics && topics.length > 0 ? <Help>Press and hold a topic to remove it.</Help> : null}

        {ideas.length > 0 ? (
          <Card>
            <Text style={{ ...type.headline, color: c.text }}>Ideas</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {ideaPage(ideas, ideaPageIndex).map((idea) => (
                <Tappable
                  key={idea.name}
                  onPress={() => { haptic.tap(); openIdea(idea.name); }}
                  disabled={opening !== null}
                  accessibilityRole="button"
                  accessibilityHint="Opens a text on this topic"
                  hitSlop={{ top: 4, bottom: 4 }}
                  scaleTo={0.95}
                  restOpacity={opening && opening !== idea.name ? 0.6 : 1}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 36, paddingHorizontal: space.m,
                    borderRadius: radius.pill, backgroundColor: c.fill,
                  }}
                >
                  {opening === idea.name ? <ActivityIndicator size="small" color={c.accent} /> : null}
                  <Text style={{ ...type.subhead, color: c.text }}>{idea.name}</Text>
                </Tappable>
              ))}
            </View>
            {ideas.length > ideaPage(ideas, 0).length ? (
              <View style={{ alignItems: 'flex-start' }}>
                <HeaderAction label="More ideas" onPress={() => setIdeaPageIndex((p) => p + 1)} />
              </View>
            ) : null}
            <Help>
              {`${language === 'es' ? '' : 'Ideas that use more of your deck come first. '}Tap one to read about it, and star it to keep texts coming.`}
            </Help>
          </Card>
        ) : null}

        <Card>
          <Field label="New topic" placeholder="Type your own" value={newName} onChangeText={setNewName} onSubmitEditing={add} returnKeyType="done" />
          {addError ? <ErrorNote message={addError} /> : null}
          <Button label="Add" variant="secondary" onPress={add} busy={adding} disabled={!newName.trim()} />
          <Help>New topics start as favorites, so a text is written for them right away.</Help>
        </Card>

        <Group>
          <NavRow first label="Past texts" detail="Read or listen to a text again" onPress={onPast} />
          <NavRow label="Marked words" detail={markedCount === null ? undefined : `${markedCount} marked as unknown`} onPress={onWords} />
          {settings ? <NavRow label="Grammar" detail={grammar ?? 'Practice or avoid'} onPress={onGrammar} /> : null}
        </Group>

        {settings ? (
          <Card>
            {/* `decks` is missing from a server older than the deck setting. */}
            {settings.decks ? (
              <>
                <Select
                  label={`${LANGUAGES[settings.language].name} deck`}
                  options={deckNames.includes(settings.decks[settings.language]) ? deckNames : [settings.decks[settings.language], ...deckNames]}
                  value={settings.decks[settings.language]}
                  onChange={(deck) => changeSetting({ decks: { [settings.language]: deck } })}
                />
                <Help>Words come from this deck and its subdecks. A new deck is read right away; texts already waiting were written from the old one.</Help>
              </>
            ) : null}
            <Text style={{ ...type.headline, color: c.text }}>Text type</Text>
            <Segments<Form>
              options={[{ value: 'dialogue', label: 'Dialogue' }, { value: 'story', label: 'Short story' }]}
              value={settings.form}
              onChange={(form) => changeSetting({ form })}
            />
            <Help>{FORM_HINT[settings.form]}</Help>
            <Text style={{ ...type.headline, color: c.text }}>Length</Text>
            <Segments<Length>
              options={[{ value: 6, label: 'Short' }, { value: 8, label: 'Medium' }, { value: 12, label: 'Long' }]}
              value={settings.lines}
              onChange={(lines) => changeSetting({ lines })}
            />
            <Help>{`${settings.lines} lines. Applies from the next text written.`}</Help>
            <Text style={{ ...type.headline, color: c.text }}>Practice words</Text>
            <Segments<StretchWords>
              options={[{ value: 'topic', label: 'Fit the topic' }, { value: 'any', label: 'Any due word' }]}
              value={settings.stretch_words}
              onChange={(stretch_words) => changeSetting({ stretch_words })}
            />
            <Help>{STRETCH_HINT[settings.stretch_words]}</Help>
            {settingError ? <ErrorNote message={settingError} /> : null}
          </Card>
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

function TopicList({ title, topics, help, onOpen, onStar, onRemove }: {
  title: string;
  topics: Topic[];
  help?: string;
  onOpen: (t: Topic) => void;
  onStar: (t: Topic) => void;
  onRemove: (t: Topic) => void;
}) {
  const c = useTheme();
  return (
    <Card style={{ paddingVertical: space.m, gap: 0 }}>
      <Text style={{ ...type.headline, color: c.text, paddingBottom: space.s }}>{title}</Text>
      {topics.map((t, i) => <TopicRow key={t.id} topic={t} first={i === 0} onOpen={onOpen} onStar={onStar} onRemove={onRemove} />)}
      {help ? <View style={{ paddingTop: space.s }}><Help>{help}</Help></View> : null}
    </Card>
  );
}

function TopicRow({ topic, first, onOpen, onStar, onRemove }: {
  topic: Topic;
  first: boolean;
  onOpen: (t: Topic) => void;
  onStar: (t: Topic) => void;
  onRemove: (t: Topic) => void;
}) {
  const c = useTheme();
  const state = STATE_TEXT[topic.state];
  // The star and the row are siblings, so VoiceOver can reach each one on its own.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, borderTopWidth: first ? 0 : 1, borderTopColor: c.border }}>
      <Pressable
        onPress={() => onStar(topic)}
        hitSlop={space.s}
        accessibilityRole="button"
        accessibilityLabel={topic.favorite ? `Remove ${topic.name} from favorites` : `Add ${topic.name} to favorites`}
        style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
      >
        <Icon name={topic.favorite ? 'star.fill' : 'star'} size={20} color={topic.favorite ? c.accent : c.textTertiary} />
      </Pressable>
      <Pressable
        onPress={() => onOpen(topic)}
        onLongPress={() => onRemove(topic)}
        accessibilityActions={[{ name: 'remove', label: 'Remove topic' }]}
        onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'remove') onRemove(topic); }}
        accessibilityRole="button"
        accessibilityLabel={state ? `${topic.name}, ${state}` : topic.name}
        accessibilityHint="Opens a text on this topic"
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: MIN_TAP, paddingVertical: space.s, opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={{ ...type.body, color: c.text, flex: 1 }}>{topic.name}</Text>
        {topic.state === 'ready' ? (
          <Text style={{ ...type.footnote, fontWeight: '600', color: c.onSpeakerB, backgroundColor: c.speakerB, paddingHorizontal: space.s, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' }}>Ready</Text>
        ) : topic.state === 'writing' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            <ActivityIndicator size="small" color={c.accent} />
            <Text style={{ ...type.footnote, color: c.textSecondary }}>Writing a text</Text>
          </View>
        ) : topic.state === 'failed' ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>Couldn't write one</Text>
        ) : null}
        <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
      </Pressable>
    </View>
  );
}

const FORM_HINT: Record<Form, string> = {
  dialogue: 'Two people talking. Applies from the next text written.',
  story: "A short story told by a narrator. Stories describe more, so they're a little harder to fit to your deck. Applies from the next text written.",
};

const STRETCH_HINT: Record<StretchWords, string> = {
  topic: 'Picked from your due and newer cards to fit the topic. Applies from the next text written.',
  any: "Any of your due and newer cards, even ones that don't fit the topic. Applies from the next text written.",
};

const STATE_TEXT: Record<Topic['state'], string | null> = {
  ready: 'ready',
  writing: 'writing a text',
  failed: "couldn't write one",
  idle: null,
};
