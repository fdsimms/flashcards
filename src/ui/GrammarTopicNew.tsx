import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { failureText } from '../core/failure';
import { ApiError, type Api, type GrammarTopic, type GrammarTopicRow, type Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { prefs } from '../reader/storage';
import { TOPIC_TITLE_MAX, topicIdeas, topicTitle } from '../reader/topics';
import { Button, Chip, ErrorNote, Help, Screen } from './kit';
import { TopicImagePicker, type PickedImage } from './TopicImagePicker';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Asking for a grammar topic (Your topics): a few words for a grammar idea the catalog doesn't have, in the
 * language chosen on the Grammar screen. The server writes the page in the background, so this only starts it
 * and opens its page, which waits for it. Nothing here grades or schedules anything.
 *
 * With Settings, Read & Listen, "Start a topic from an image" on, "From an image" also fills the title from a photo
 * or screenshot of a grammar book's page (the server has Claude name the grammar point). The title is the
 * only thing that comes from the image: it can be edited, and the page is written as a typed topic's is.
 */
export function GrammarTopicNew({ api, language, onWriting }: {
  api: Api;
  language: Language;
  /** The page being written, to open in place of this screen. */
  onWriting: (topic: GrammarTopic) => void;
}) {
  const c = useTheme();
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const dark = useColorScheme() === 'dark';
  const [title, setTitle] = useState('');
  const [have, setHave] = useState<GrammarTopicRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const [reading, setReading] = useState(false);
  const [imageRead, setImageRead] = useState(false);
  const fromImage = prefs().topicImages;
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
      setError(e instanceof ApiError ? e.message : failureText(e, { what: "Couldn't start writing the page.", next: 'Try again.' }));
      starting.current = false;
      setBusy(false);
    }
  };

  const readImage = async (image: PickedImage) => {
    if (reading) return;
    setReading(true);
    setError(null);
    try {
      const got = await api.readTopicImage(language, image.base64, image.mediaType);
      setTitle(topicTitle(got.title));
      setImageRead(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : failureText(e, { what: "Couldn't read the image.", next: 'Try again, or type the topic.' }));
    } finally {
      setReading(false);
    }
  };

  return (
    <Screen title="New topic" largeTitle={false} footer={<Button label="Write the page" onPress={start} disabled={!ready} busy={busy} />}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ ...readable, padding: space.l, paddingBottom: space.l + bottomPadding, gap: space.l }} {...scrollProps}>
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
            editable={!reading}
            style={{
              ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
              borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
            }}
          />
        </View>
        {fromImage ? (
          <View style={{ gap: space.s }}>
            <TopicImagePicker
              label={reading ? 'Reading the image' : imageRead ? 'Use a different image' : 'From an image'}
              disabled={reading}
              onPicked={readImage}
              onFailed={(e) => setError(failureText(e, { what: "Couldn't get the image.", next: 'Try again, or type the topic.' }))}
            />
            {imageRead && !error ? <Help>Claude named this topic from your image. Change the title if it isn't what you want.</Help> : null}
          </View>
        ) : null}
        {topicIdeas(language, have).length ? (
          <View style={{ gap: space.s }}>
            <Text style={{ ...type.overline, color: c.textSecondary }}>Ideas</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {topicIdeas(language, have).map((idea) => (
                <Chip key={idea} label={idea} accessibilityLabel={`Use the idea: ${idea}`} onPress={() => setTitle(idea)} />
              ))}
            </View>
          </View>
        ) : null}
        {error ? <ErrorNote message={error} /> : null}
        <Help>Takes about 20 seconds and one request to Claude. The examples use only words you know.{fromImage ? ' An image is sent to Claude to read the topic and isn\'t saved.' : ''}</Help>
      </ScrollView>
    </Screen>
  );
}
