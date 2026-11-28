import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { ApiError, MAX_STORY_ABOUT_CHARS, MAX_TOPIC_CHARS, type Api, type GlossLanguage, type TextModel } from '../../reader/api';
import type { Genre } from '../../reader/genre';
import { glossInfo } from '../../reader/languages';
import { surprisePick } from '../../reader/shelf';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Group, Help, Icon, Screen, Segments, Tappable } from '../kit';
import { WorkingMark } from '../WorkingMark';
import { hairline, radius, readable, smooth, space, type, useTheme } from '../theme';
import { useCoverTint } from './Cover';
import { GenrePick } from './GenrePick';
import { useKeyboardScroll } from '../useKeyboardScroll';
import { ReadOwnText } from './ReadOwnText';
import { ReadVideo } from './ReadVideo';
import { prefs } from '../../reader/storage';
import type { SharedItem } from '../../core/shareInbox';

export type NewKind = 'series' | 'dialogue' | 'story' | 'own' | 'video';

/**
 * Having something written, from the home's + button, as a sheet. First a series, a dialogue or a
 * story (`kind` skips the choice), or a text of your own to paste in (ReadOwnText.tsx). A series takes an optional line about what it's about and starts
 * running beside the others. A dialogue or a story is Surprise me (a topic idea the deck fits), or
 * a typed topic. Each is written in the background and shows on the home when it's ready, so the
 * sheet closes as soon as it's asked for.
 */
export function ReadWrite({ api, language, kind: initialKind, shared, onDone }: { api: Api; language?: GlossLanguage; kind?: NewKind; /** Text shared from another app, for Your own text. */ shared?: SharedItem; onDone: () => void }) {
  const c = useTheme();
  // Your own text needs the language it's in; without one (settings not loaded yet) the choice shows instead.
  const [kind, setKind] = useState<NewKind | null>((initialKind === 'own' || initialKind === 'video') && !language ? null : initialKind ?? null);
  const [about, setAbout] = useState('');
  const [name, setName] = useState('');
  const [genre, setGenre] = useState<Genre>('any');
  const [model, setModel] = useState<TextModel>('claude-sonnet-5-5');
  // Which way is working: the others are disabled meanwhile, without a spinner of their own.
  const [busy, setBusy] = useState<'write' | 'surprise' | 'series' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { scrollProps, bottomPadding } = useKeyboardScroll();

  const write = async () => {
    const topic = name.trim();
    if (!topic || busy || kind === null || kind === 'series' || kind === 'own' || kind === 'video') return;
    Keyboard.dismiss();
    setBusy('write');
    setError(null);
    try {
      await api.writeAbout(topic, kind, model, genre);
      haptic.tap();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing that. Try again.");
      setBusy(null);
    }
  };

  const surprise = async () => {
    if (busy || kind === null || kind === 'series' || kind === 'own' || kind === 'video') return;
    Keyboard.dismiss();
    setBusy('surprise');
    setError(null);
    try {
      const pick = surprisePick(await api.suggestions(), Math.random);
      if (!pick) throw new ApiError(`There are no topic ideas left. Type a topic below and write a ${kind} on it instead.`, 0);
      await api.writeAbout(pick, kind, model, genre);
      haptic.tap();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing that. Try again.");
      setBusy(null);
    }
  };

  const startSeries = async () => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy('series');
    setError(null);
    try {
      await api.startStory(about.trim(), genre);
      haptic.tap();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a series. Try again.");
      setBusy(null);
    }
  };

  const languageName = language ? `${glossInfo(language).name} ` : '';
  const cancel = (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={onDone}>Cancel</Stack.Toolbar.Button>
    </Stack.Toolbar>
  );

  if (kind === null) {
    return (
      <Screen title={`New ${languageName}text`} largeTitle={false} toolbar={cancel}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl, gap: space.m }}>
          <KindTile tintKey="story:new" icon="book" title="Series" detail="Episodes that pick up where the last one ended, with the same people and places." onPress={() => setKind('series')} />
          <KindTile tintKey="quick:new" icon="bubble.left.and.bubble.right" title="Dialogue" detail="A short conversation between two people." onPress={() => setKind('dialogue')} />
          <KindTile tintKey="story:alone" icon="doc.text" title="Story" detail="A short story that stands on its own." onPress={() => setKind('story')} />
          <Help>Each one takes about half a minute and shows on your shelf when it's ready.</Help>
          {language ? <KindTile tintKey="own:new" icon="doc.on.clipboard" title="Your own text" detail="Paste an article, a chapter or song lyrics to read and listen to." onPress={() => setKind('own')} /> : null}
          {language && prefs().videos ? <KindTile tintKey="video:new" icon="play.rectangle" title="A video" detail="A YouTube video, with its subtitles to read along under it." onPress={() => setKind('video')} /> : null}
        </ScrollView>
      </Screen>
    );
  }

  if (kind === 'video' && language) {
    return <ReadVideo api={api} language={language} shared={shared} toolbar={cancel} onDone={onDone} />;
  }

  if (kind === 'own' && language) {
    return <ReadOwnText api={api} language={language} shared={shared} toolbar={cancel} onDone={onDone} />;
  }

  if (kind === 'series') {
    return (
      <Screen
        title={`New ${languageName}series`}
        largeTitle={false}
        toolbar={cancel}
        footer={<Button label="Start series" onPress={startSeries} busy={busy === 'series'} />}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
          keyboardShouldPersistTaps="handled"
          {...scrollProps}
        >
          <Help>A story told in episodes, with the same people and places, written from the words in your deck. Each new episode is written after you read the last one. Your pinned series stays pinned.</Help>
          <Field label="What should it be about?" placeholder="e.g. a small café on a rainy day" value={about} onChangeText={setAbout} maxLength={MAX_STORY_ABOUT_CHARS} returnKeyType="done" onSubmitEditing={startSeries} />
          <GenrePick genre={genre} onChange={setGenre} />
          <Help>Leave the topic empty and Claude picks what the series is about. The genre is kept for every episode and doesn't change which words are used.</Help>
          {error ? <ErrorNote message={error} /> : null}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen
      title={`New ${languageName}${kind}`}
      largeTitle={false}
 toolbar={cancel}
      footer={<Button label="Write" onPress={write} busy={busy === 'write'} busyLabel="Starting to write" disabled={!name.trim() || busy !== null} />}
    >
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        <Group>
          <Tappable
            onPress={() => { haptic.tap(); surprise(); }}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Surprise me. Writes a text on an idea you haven't tried, picked for your deck"
            accessibilityState={{ disabled: busy !== null, busy: busy === 'surprise' }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l, opacity: busy === 'write' ? 0.5 : 1 }}
          >
            <View style={{ width: 44, height: 44, borderRadius: radius.m, ...smooth, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="dice" size={22} color={c.accentInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.headline, color: c.text }}>Surprise me</Text>
              {busy === 'surprise' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                  <WorkingMark />
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>Picking an idea from your deck</Text>
                </View>
              ) : <Text style={{ ...type.footnote, color: c.textSecondary }}>An idea you haven't tried, picked for your deck</Text>}
            </View>
          </Tappable>
        </Group>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.xs }}>
          <View style={{ flex: 1, height: hairline, backgroundColor: c.border }} />
          <Text style={{ ...type.footnote, color: c.textSecondary }}>or choose a topic</Text>
          <View style={{ flex: 1, height: hairline, backgroundColor: c.border }} />
        </View>

        <Field label="Topic" placeholder="e.g. haggling at a market" value={name} onChangeText={setName} maxLength={MAX_TOPIC_CHARS} returnKeyType="done" onSubmitEditing={write} />
        <GenrePick genre={genre} onChange={setGenre} />
        <Text style={{ ...type.footnote, color: c.textSecondary }}>Written by</Text>
        <Segments<TextModel> options={[{ value: 'claude-sonnet-5-5', label: 'Sonnet' }, { value: 'claude-haiku-5-5', label: 'Haiku' }]} value={model} onChange={setModel} />
        {error ? <ErrorNote message={error} /> : null}
        <Help>Genre sets the kind of {kind}. Surprise me follows it too, and it doesn't change which words are used.</Help>
        <Help>Takes about half a minute. It shows under Texts when it's ready.</Help>
      </ScrollView>
    </Screen>
  );
}

/** One of the two kinds on the sheet's first step, as a tinted tile like the home's covers. */
function KindTile({ tintKey, icon, title, detail, onPress }: { tintKey: string; icon: SFSymbol; title: string; detail: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.m + 2, padding: space.l, borderRadius: radius.l + 2, ...smooth, backgroundColor: useCoverTint(tintKey) }}
    >
      <Icon name={icon} size={28} color={c.accentInk} />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.headline, fontSize: 19, lineHeight: 24, color: c.text }}>{title}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 20 }}>{detail}</Text>
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Tappable>
  );
}
