import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { failureText } from '../core/failure';
import { ApiError, type Api, type GrammarTopic, type GrammarTopicRow, type Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { TOPIC_TITLE_MAX, topicIdeas, topicTitle } from '../reader/topics';
import { haptic } from './haptics';
import { Button, ErrorNote, Help, Screen, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';

/**
 * Asking for a grammar topic (Your topics): a few words for a grammar idea the catalog doesn't have, in the
 * language chosen on the Grammar screen. The server writes the page in the background, so this only starts it
 * and opens its page, which waits for it. Nothing here grades or schedules anything.
 */
export function GrammarTopicNew({ api, language, onWriting }: {
  api: Api;
  language: Language;
  /** The page being written, to open in place of this screen. */
  onWriting: (topic: GrammarTopic) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [title, setTitle] = useState('');
  const [have, setHave] = useState<GrammarTopicRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const name = LANGUAGES[language].name;
  const ready = topicTitle(title).length > 0;

  useEffect(() => {
    let live = true;
    api.topics(language).then((r) => { if (live) setHave(r.topics); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, language]);

  const start = async () => {
    const wanted = topicTitle(title);
    if (!wanted || starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(null);
    try {
      onWriting(await api.createTopic(language, wanted));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failureText(e, { what: "Couldn't start the page.", next: 'Try again.' }));
      starting.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen title="New topic" largeTitle={false} footer={<Button label="Write the page" onPress={start} disabled={!ready} busy={busy} />}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, gap: space.l }}>
        <View style={{ gap: space.s }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>{`What do you want to learn in ${name}?`}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            onSubmitEditing={start}
            returnKeyType="go"
            autoFocus
            placeholder="A grammar idea, in a few words"
            accessibilityLabel={`A ${name} grammar topic`}
            placeholderTextColor={c.textTertiary}
            selectionColor={c.accent}
            keyboardAppearance={dark ? 'dark' : 'light'}
            maxLength={TOPIC_TITLE_MAX}
            style={{
              ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
              borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
            }}
          />
        </View>
        {topicIdeas(language, have).length ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.overline, color: c.textSecondary }}>Ideas</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {topicIdeas(language, have).map((idea) => (
                <Tappable
                  key={idea}
                  onPress={() => { haptic.tap(); setTitle(idea); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use the idea: ${idea}`}
                  hitSlop={{ top: space.s, bottom: space.s }}
                  style={{ backgroundColor: c.accentFill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s }}
                >
                  <Text style={{ ...type.subhead, color: c.text }}>{idea}</Text>
                </Tappable>
              ))}
            </View>
          </View>
        ) : null}
        {error ? <ErrorNote message={error} /> : null}
        <Help>Takes about 20 seconds. The examples use only words you know, and each page is one Claude call.</Help>
      </ScrollView>
    </Screen>
  );
}
