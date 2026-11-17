import { Stack } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, Text, View } from 'react-native';
import { ApiError, MAX_TOPIC_CHARS, type Api, type Form, type Language, type TextModel } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { surprisePick } from '../../reader/shelf';
import { haptic } from '../haptics';
import { Button, ErrorNote, Field, Group, Help, Icon, Screen, Segments, Tappable } from '../kit';
import { hairline, radius, readable, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';

/**
 * Having a text written, from the shelf's + button, as a sheet: Surprise me (a topic idea the deck
 * fits, in a random form), or a typed topic in Dialogue or Story. Either is written in the
 * background and joins the shelf when it's ready, so the sheet closes as soon as it's asked for.
 */
export function ReadWrite({ api, language, onDone }: { api: Api; language?: Language; onDone: () => void }) {
  const c = useTheme();
  const [name, setName] = useState('');
  const [form, setForm] = useState<Form>('dialogue');
  const [model, setModel] = useState<TextModel>('claude-sonnet-5-5');
  // Which way is working: the other is disabled meanwhile, without a spinner of its own.
  const [busy, setBusy] = useState<'write' | 'surprise' | null>(null);
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

  return (
    <Screen
      title={language ? `New ${LANGUAGES[language].name} text` : 'New text'}
      largeTitle={false}
      toolbar={(
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={onDone}>Cancel</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
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
