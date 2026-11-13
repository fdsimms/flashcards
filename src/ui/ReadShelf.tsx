import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Keyboard, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type Form, type Language, type Shelf, type ShelfText } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { cardDetail, playMinutes, playOrder, reasonLabel, surprisePick } from '../reader/shelf';
import { haptic } from './haptics';
import { Button, Card, ErrorNote, Field, Group, HeaderAction, Help, Icon, NavRow, Screen, Segments, Tappable } from './kit';
import { hairline, MIN_TAP, radius, space, type, useTheme } from './theme';

/**
 * Read & Listen's home: one language's shelf (docs/read-and-listen/architecture.md, Shelf). On top,
 * the ongoing story's next episode; under it the texts written ahead, each saying why it's there;
 * then a field to have one written on any topic. Opening a text never waits, since it's written
 * already. The language is a menu in the header, and its settings are behind the sliders button.
 *
 * The server fills the shelf in the background after each request, so this asks again while
 * something is being written, and briefly while the shelf isn't full, to show texts as they land.
 */

// While something is being written, check back this often.
const POLL_MS = 10_000;
// A shelf that isn't full with nothing being written is asked again this many times, in case the
// background top-up hadn't started when it was last asked; then it waits for a refresh.
const IDLE_POLLS = 2;
// The server's SHELF_SIZE (server/reader/src/franki_reader/engine.py).
const SHELF_SIZE = 3;

export type OpenText = { textId: number; order: number[]; playAll?: boolean };

export function ReadShelf({ api, practice, onOpen, onPractice, onLanguagePage, onPast, onWords, onLanguage }: {
  api: Api;
  /** Opened from Review's "Read a text with these words": offers a text written to practice them. */
  practice?: { language: Language; count: number; onCancel: () => void };
  onOpen: (open: OpenText) => void;
  /** Writes a text on `topicId` practicing the words just studied (the reader waits for it). */
  onPractice: (topic: { id: number; name: string }) => void;
  onLanguagePage: () => void;
  onPast: () => void;
  onWords: () => void;
  /** The language was changed here; the app-wide settings follow. */
  onLanguage: () => void;
}) {
  const c = useTheme();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [markedCount, setMarkedCount] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Bumped when the language changes, so a load started before it is dropped rather than shown.
  const loadSeq = useRef(0);
  const idlePolls = useRef(0);
  const load = useCallback(async () => {
    const started = loadSeq.current;
    try {
      const loaded = await api.shelf();
      if (started !== loadSeq.current) return;
      setShelf(loaded);
      setError(null);
    } catch (e) {
      if (started !== loadSeq.current) return;
      setError(e instanceof ApiError ? e.message : "Couldn't load your shelf. Pull down to try again.");
    }
    api.markedWords().then((ws) => { if (started === loadSeq.current) setMarkedCount(ws.length); }, () => undefined);
  }, [api]);
  // Not only on mount: the reader opens on top of this screen, so what was just finished (the story's
  // next episode, the texts left on the shelf) is only known to the server until this asks again.
  useFocusEffect(useCallback(() => {
    idlePolls.current = 0;
    load();
  }, [load]));

  const busy = !!shelf && (shelf.writing.length > 0 || !!shelf.story?.writing);
  const short = !!shelf && shelf.texts.length < SHELF_SIZE;
  useEffect(() => {
    if (!shelf) return;
    if (busy) idlePolls.current = 0;
    else if (!short || idlePolls.current >= IDLE_POLLS) return;
    const id = setTimeout(() => {
      if (!busy) idlePolls.current++;
      load();
    }, busy ? POLL_MS : POLL_MS / 3);
    return () => clearTimeout(id);
  }, [shelf, busy, short, load]);

  const refresh = async () => {
    setRefreshing(true);
    idlePolls.current = 0;
    await load();
    setRefreshing(false);
  };

  const changeLanguage = async (language: Language) => {
    if (language === shelf?.language) return;
    loadSeq.current++;
    setShelf(null);
    setError(null);
    try {
      await api.updateSettings({ language });
      onLanguage();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't switch the language. Try again.");
    }
    idlePolls.current = 0;
    await load();
  };

  // Words just studied are in one language: switch to it, once, so the text is written in it.
  const switched = useRef(false);
  useEffect(() => {
    if (!practice || !shelf || switched.current) return;
    switched.current = true;
    if (shelf.language !== practice.language) changeLanguage(practice.language);
  }, [practice, shelf]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = shelf ? playOrder(shelf) : [];
  const open = (textId: number, playAll = false) => onOpen({ textId, order, playAll });

  const textActions = (text: ShelfText) => {
    const like = text.liked ? 'Fewer like this' : 'More like this';
    ActionSheetIOS.showActionSheetWithOptions(
      { title: text.title, options: [like, 'Not this', 'Cancel'], cancelButtonIndex: 2, destructiveButtonIndex: 1 },
      async (i) => {
        setActionError(null);
        try {
          if (i === 0) await api.setFavorite(text.topic_id, !text.liked);
          else if (i === 1) await api.skip(text.id);
          else return;
          haptic.tap();
        } catch (e) {
          setActionError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
        }
        idlePolls.current = 0;
        load();
      },
    );
  };

  const [practiceBusy, setPracticeBusy] = useState(false);
  const startPractice = async () => {
    if (!shelf || practiceBusy) return;
    setPracticeBusy(true);
    setActionError(null);
    try {
      // A theme the owner likes, else the idea that best fits the deck.
      const theme = shelf.themes.length ? shelf.themes[Math.floor(Math.random() * shelf.themes.length)] : null;
      if (theme) onPractice(theme);
      else {
        const [idea] = await api.suggestions();
        if (!idea) throw new ApiError('There are no topic ideas left. Type a topic below and write a text on it instead.', 0);
        onPractice(await api.addTopic(idea.name, false));
      }
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Couldn't start that text. Try again.");
    } finally {
      setPracticeBusy(false);
    }
  };

  const language = shelf?.language;
  const name = language ? LANGUAGES[language].name : 'Read & Listen';

  return (
    <Screen
      title={name}
      toolbar={(
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Menu icon="globe" accessibilityLabel={`Language: ${name}. Change the language`}>
              {(shelf?.languages ?? []).map((l) => (
                <Stack.Toolbar.MenuAction
                  key={l.code}
                  isOn={l.code === language}
                  subtitle={l.ready > 0 ? `${l.ready} ready` : undefined}
                  onPress={() => changeLanguage(l.code)}
                >
                  {l.name}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button icon="slider.horizontal.3" accessibilityLabel={`${name} settings`} onPress={onLanguagePage} />
          </Stack.Toolbar>
        </>
      )}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {practice ? (
          <Card style={{ gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text }}>{`Practice the ${practice.count} ${practice.count === 1 ? 'word' : 'words'} you just studied`}</Text>
            <Help>A text is written with as many of them as fit. It takes about half a minute.</Help>
            <Button label="Write a text with them" onPress={startPractice} busy={practiceBusy} disabled={!shelf} />
            <View style={{ alignItems: 'flex-start' }}><HeaderAction label="Not now" onPress={practice.onCancel} /></View>
          </Card>
        ) : null}

        {error ? <ErrorNote message={error} onRetry={refresh} /> : null}
        {actionError ? <ErrorNote message={actionError} /> : null}
        {!shelf && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}

        {shelf ? (
          <>
            <StoryCard api={api} shelf={shelf} onOpen={(id) => open(id)} onStarted={refresh} />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.s }}>
              <Text accessibilityRole="header" style={{ ...type.title, color: c.text }}>Ready for you</Text>
              {order.length > 0 ? (
                <Tappable
                  onPress={() => { haptic.tap(); open(order[0], true); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Play all, about ${playMinutes(shelf)} minutes`}
                  style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.xs }}
                >
                  <Icon name="headphones" size={17} color={c.accent} />
                  <Text style={{ ...type.subhead, fontWeight: '600', color: c.accent }}>{`Play all · ${playMinutes(shelf)} min`}</Text>
                </Tappable>
              ) : null}
            </View>

            {shelf.texts.length > 0 || shelf.writing.length > 0 ? (
              <Group>
                {shelf.texts.map((t, i) => (
                  <ShelfRow key={t.id} text={t} first={i === 0} onPress={() => open(t.id)} onLongPress={() => textActions(t)} />
                ))}
                {shelf.writing.map((w, i) => (
                  <View key={`${w.topic}:${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l, borderTopWidth: shelf.texts.length + i === 0 ? 0 : 1, borderTopColor: c.border }}>
                    <ActivityIndicator size="small" color={c.accent} />
                    <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>
                      {w.reason === 'asked' ? `Writing "${w.topic}"` : 'Writing a new text'}
                    </Text>
                  </View>
                ))}
              </Group>
            ) : (
              <Help>Texts are written here a few at a time, from the words in your deck. Pull down to check for them.</Help>
            )}
            {shelf.texts.length > 0 ? <Help>Press and hold a text for More like this or Not this. Texts are only written for a language you open here, and at most 3 wait at a time.</Help> : null}

            <WriteCard api={api} onWriting={refresh} />

            <Group>
              <NavRow first label="Past texts" detail="Read or listen to a text again" onPress={onPast} />
              <NavRow label="Marked words" detail={markedCount === null ? undefined : `${markedCount} marked as unknown`} onPress={onWords} />
            </Group>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function ShelfRow({ text, first, onPress, onLongPress }: { text: ShelfText; first: boolean; onPress: () => void; onLongPress: () => void }) {
  const c = useTheme();
  const reason = reasonLabel(text);
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      onLongPress={() => { haptic.select(); onLongPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${text.title}. ${cardDetail(text)}. ${reason}`}
      accessibilityHint="Opens the text"
      accessibilityActions={[{ name: 'more', label: 'More like this, or Not this' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'more') onLongPress(); }}
      scaleTo={0.99}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l, borderTopWidth: first ? 0 : 1, borderTopColor: c.border }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, color: c.text }}>{text.title}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{cardDetail(text)}</Text>
        <Text style={{ ...type.footnote, color: text.reason === 'due' ? c.countDue : c.textSecondary }}>{reason}</Text>
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Tappable>
  );
}

/** The ongoing story: its next episode, the one being written, or a way to start one. */
function StoryCard({ api, shelf, onOpen, onStarted }: { api: Api; shelf: Shelf; onOpen: (textId: number) => void; onStarted: () => void }) {
  const c = useTheme();
  const [about, setAbout] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const story = shelf.story;

  const start = async () => {
    if (starting) return;
    // A field left focused makes the scroll view scroll to it again whenever the shelf re-renders or the app returns.
    Keyboard.dismiss();
    setStarting(true);
    setError(null);
    try {
      await api.startStory(about.trim());
      setAbout('');
      onStarted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a story. Try again.");
    } finally {
      setStarting(false);
    }
  };

  if (!story) {
    return (
      <Card>
        <Text style={{ ...type.headline, color: c.text }}>Start an ongoing story</Text>
        <Help>Each episode picks up where the last one ended, with the same people and places, so the same words keep coming back. Leave the topic empty and the story is up to the writer.</Help>
        <Field label="What should it be about?" placeholder="For example, a small café on a rainy day" value={about} onChangeText={setAbout} returnKeyType="done" onSubmitEditing={start} />
        {error ? <ErrorNote message={error} /> : null}
        <Button label="Start a story" variant="secondary" onPress={start} busy={starting} />
      </Card>
    );
  }

  const name = story.title || 'Your story';
  const next = story.next;
  const episode = next ? next.episode : story.read + 1;
  return (
    <Card style={{ borderColor: c.accent, gap: space.m }}>
      <Text style={{ ...type.overline, color: c.accent }}>{`${name} · Episode ${episode}`}</Text>
      {next ? (
        <>
          <Text style={{ ...type.title, color: c.text }}>{next.title}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>{cardDetail(next)}</Text>
          {next.stretch.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>Practice words</Text>
              {next.stretch.map((w) => (
                <Text key={w} style={{ ...type.subhead, color: c.text, backgroundColor: c.accentFill, paddingHorizontal: space.s, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' }}>{w}</Text>
              ))}
            </View>
          ) : null}
          <Button label="Read and listen" onPress={() => onOpen(next.id)} />
        </>
      ) : story.writing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ActivityIndicator size="small" color={c.accent} />
          <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>Writing the next episode. This takes about half a minute.</Text>
        </View>
      ) : story.failed ? (
        <Help>{`Couldn't write the next episode: ${story.failed} It's tried again in half an hour.`}</Help>
      ) : (
        <Help>The next episode is written when you pull down or come back here.</Help>
      )}
      {story.last_recap ? (
        <View style={{ marginTop: space.s, paddingTop: space.m, gap: space.xs, borderTopWidth: hairline, borderTopColor: c.border }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>Last time</Text>
          <Help>{story.last_recap}</Help>
        </View>
      ) : null}
    </Card>
  );
}

/** A text on any topic, written in the background; it joins the shelf when it's ready. */
function WriteCard({ api, onWriting }: { api: Api; onWriting: () => void }) {
  const [name, setName] = useState('');
  const [form, setForm] = useState<Form>('dialogue');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async () => {
    const topic = name.trim();
    if (!topic || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      await api.writeAbout(topic, form);
      setName('');
      onWriting();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // A topic idea the deck fits, in a random form, written like a typed topic.
  const surprise = async () => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const pick = surprisePick(await api.suggestions(), Math.random);
      if (!pick) throw new ApiError('There are no topic ideas left. Type a topic below and write a text on it instead.', 0);
      await api.writeAbout(pick.name, pick.form);
      onWriting();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Button label="Surprise me" variant="secondary" onPress={surprise} busy={busy} />
      <Help>Writes a text on an idea you haven't tried, with no topic needed.</Help>
      <Field label="Write one about something else" placeholder="For example, haggling at a market" value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={write} />
      <Segments<Form> options={[{ value: 'dialogue', label: 'Dialogue' }, { value: 'story', label: 'Story' }]} value={form} onChange={setForm} />
      {error ? <ErrorNote message={error} /> : null}
      <Button label="Write" variant="secondary" onPress={write} busy={busy} disabled={!name.trim()} />
      <Help>Takes about half a minute. It joins the shelf when it's ready.</Help>
    </Card>
  );
}
