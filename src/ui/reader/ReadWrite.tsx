import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, Text, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { ApiError, MAX_STORY_ABOUT_CHARS, MAX_TOPIC_CHARS, type Api, type Form, type Language, type TextModel } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { surprisePick } from '../../reader/shelf';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Group, Help, Icon, Screen, Segments, Tappable } from '../kit';
import { hairline, radius, readable, smooth, space, type, useTheme } from '../theme';
import { useCoverTint } from './Cover';
import { useKeyboardScroll } from '../useKeyboardScroll';

export type NewKind = 'story' | 'quick';

/**
 * Having something written, from the home's + button, as a sheet. First a story or a quick text
 * (`kind` skips the choice). A story takes an optional line about what it's about and starts
 * running beside the others. A quick text is Surprise me (a topic idea the deck fits, in a random
 * form), or a typed topic in Dialogue or Story. Each is written in the background and shows on the
 * home when it's ready, so the sheet closes as soon as it's asked for.
 */
export function ReadWrite({ api, language, kind: initialKind, onDone }: { api: Api; language?: Language; kind?: NewKind; onDone: () => void }) {
  const c = useTheme();
  const [kind, setKind] = useState<NewKind | null>(initialKind ?? null);
  const [about, setAbout] = useState('');
  const [name, setName] = useState('');
  const [form, setForm] = useState<Form>('dialogue');
  const [model, setModel] = useState<TextModel>('claude-sonnet-5-5');
  // Which way is working: the others are disabled meanwhile, without a spinner of their own.
  const [busy, setBusy] = useState<'write' | 'surprise' | 'story' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { scrollProps, bottomPadding } = useKeyboardScroll();

  const write = async () => {
    const topic = name.trim();
    if (!topic || busy) return;
    Keyboard.dismiss();
    setBusy('write');
    setError(null);
    try {
      await api.writeAbout(topic, form, model);
      haptic.tap();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing that. Try again.");
      setBusy(null);
    }
  };

  const surprise = async () => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy('surprise');
    setError(null);
    try {
      const pick = surprisePick(await api.suggestions(), Math.random);
      if (!pick) throw new ApiError('There are no topic ideas left. Type a topic below and write a text on it instead.', 0);
      await api.writeAbout(pick.name, pick.form, model);
      haptic.tap();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing that. Try again.");
      setBusy(null);
    }
  };

  const startStory = async () => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy('story');
    setError(null);
    try {
      await api.startStory(about.trim());
      haptic.tap();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start a story. Try again.");
      setBusy(null);
    }
  };

  const languageName = language ? `${LANGUAGES[language].name} ` : '';
  const cancel = (
    <Stack.Toolbar placement="left">
      <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={onDone}>Cancel</Stack.Toolbar.Button>
    </Stack.Toolbar>
  );

  if (kind === null) {
    return (
      <Screen title={`New ${languageName}text`} largeTitle={false} toolbar={cancel}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl, gap: space.m }}>
          <KindTile tintKey="story:new" icon="book" title="Story" detail="Episodes that pick up where the last one ended, with the same people and places." onPress={() => setKind('story')} />
          <KindTile tintKey="quick:new" icon="bubble.left.and.bubble.right" title="Quick text" detail="One dialogue or story on a topic you type, or a surprise." onPress={() => setKind('quick')} />
          <Help>Either one takes about half a minute and shows on the home when it's ready.</Help>
        </ScrollView>
      </Screen>
    );
  }

  if (kind === 'story') {
    return (
      <Screen
        title={`New ${languageName}story`}
        largeTitle={false}
        toolbar={cancel}
        footer={<Button label="Start story" onPress={startStory} busy={busy === 'story'} />}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
          keyboardShouldPersistTaps="handled"
          {...scrollProps}
        >
          <Help>Each episode picks up where the last one ended, with the same people and places, so the same words keep coming back. Its next episode is written once you've read the last. The story pinned to the top of the home stays there.</Help>
          <Field label="What should it be about?" placeholder="For example, a small café on a rainy day" value={about} onChangeText={setAbout} maxLength={MAX_STORY_ABOUT_CHARS} returnKeyType="done" onSubmitEditing={startStory} />
          <Help>Leave it empty and the story is up to the writer.</Help>
          {error ? <ErrorNote message={error} /> : null}
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen
      title={`New ${languageName}quick text`}
      largeTitle={false}
 toolbar={cancel}
      footer={<Button label="Write" onPress={write} busy={busy === 'write'} disabled={!name.trim() || busy !== null} />}
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
            <View style={{ width: 44, height: 44, borderRadius: radius.m, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="dice" size={22} color={c.accentInk} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.headline, color: c.text }}>Surprise me</Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>An idea you haven't tried, picked for your deck</Text>
            </View>
            {busy === 'surprise' ? <ActivityIndicator color={c.textSecondary} /> : null}
          </Tappable>
        </Group>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.xs }}>
          <View style={{ flex: 1, height: hairline, backgroundColor: c.border }} />
          <Text style={{ ...type.footnote, color: c.textSecondary }}>or choose a topic</Text>
          <View style={{ flex: 1, height: hairline, backgroundColor: c.border }} />
        </View>

        <Field label="Topic" placeholder="For example, haggling at a market" value={name} onChangeText={setName} maxLength={MAX_TOPIC_CHARS} returnKeyType="done" onSubmitEditing={write} />
        <Segments<Form> options={[{ value: 'dialogue', label: 'Dialogue' }, { value: 'story', label: 'Story' }]} value={form} onChange={setForm} />
        <Text style={{ ...type.footnote, color: c.textSecondary }}>Written by</Text>
        <Segments<TextModel> options={[{ value: 'claude-sonnet-5-5', label: 'Sonnet' }, { value: 'claude-haiku-5-5', label: 'Haiku' }]} value={model} onChange={setModel} />
        {error ? <ErrorNote message={error} /> : null}
        <Help>Takes about half a minute. It joins the shelf when it's ready.</Help>
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
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.headline, fontSize: 19, color: c.text }}>{title}</Text>
        <Text style={{ ...type.subhead, color: c.textSecondary, lineHeight: 20 }}>{detail}</Text>
      </View>
      <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
    </Tappable>
  );
}
