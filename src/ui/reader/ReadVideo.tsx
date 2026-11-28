import { router } from 'expo-router';
import React, { useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { type Api, ApiError, type GlossLanguage, type VideoPreview } from '../../reader/api';
import { flaggedName, glossInfo, TEXT_LANGUAGE_ORDER } from '../../reader/languages';
import { coverageNote, costText, moreNewWords, newWordsTitle, percentKnown } from '../../reader/ownText';
import { prefs } from '../../reader/storage';
import { videoIdOf, videoLength } from '../../reader/video';
import { shareSource, type SharedItem } from '../../core/shareInbox';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Help, Meter, Screen, Select } from '../kit';
import { radius, readable, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';

/**
 * A YouTube video to watch with its subtitles (docs/read-and-listen/architecture.md, "Videos";
 * server/reader video.py): a link pasted here, or a video shared to Franki (`shared`). Check asks the
 * server for its subtitles in the language and shows what adding it would give: its length, how much
 * is known, the words that aren't, and what translating it costs. Add to shelf puts it on the Your
 * texts row, where it opens on Watch. Off until Settings, Reading and listening, Videos turns it on,
 * since the server then asks YouTube. `toolbar` is New text's Cancel.
 */
export function ReadVideo({ api, language: readerLanguage, shared, toolbar, onDone }: { api: Api; language: GlossLanguage; shared?: SharedItem; toolbar: React.ReactNode; onDone: () => void }) {
  const c = useTheme();
  const [language, setLanguage] = useState<GlossLanguage>(readerLanguage);
  const [link, setLink] = useState(shared?.url ?? shared?.text ?? '');
  const [preview, setPreview] = useState<{ language: GlossLanguage; link: string; found: VideoPreview } | null>(null);
  const [busy, setBusy] = useState<'check' | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const name = glossInfo(language).name;
  const on = prefs().videos;
  const id = videoIdOf(link);
  const current = preview && preview.language === language && preview.link === link ? preview.found : null;

  const check = async () => {
    if (busy || !id) return;
    Keyboard.dismiss();
    setBusy('check');
    setError(null);
    const asked = { language, link };
    try {
      const found = await api.videoPreview(asked.language, asked.link);
      setPreview({ ...asked, found });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check the video. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (busy || !current) return;
    setBusy('add');
    setError(null);
    try {
      await api.addVideo(language, link);
      haptic.success();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add the video. Try again.");
      setBusy(null);
    }
  };

  if (!on) {
    return (
      <Screen title="A video" largeTitle={false} toolbar={toolbar}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, gap: space.m }}>
          <Help>Watching videos with their subtitles is off. Turn it on in Settings, Reading and listening, Videos. Your server then asks YouTube for a video's subtitles when you add one.</Help>
          <Button label="Open Reading and listening" variant="secondary" onPress={() => router.push('/read-listening')} />
        </ScrollView>
      </Screen>
    );
  }

  const footer = current
    ? <Button label="Add to shelf" onPress={add} busy={busy === 'add'} busyLabel="Adding" />
    : <Button label="Check" onPress={check} busy={busy === 'check'} busyLabel="Checking" disabled={!id || busy !== null} />;

  return (
    <Screen title={`A ${name} video`} largeTitle={false} toolbar={toolbar} footer={footer}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        <Help>
          {shared
            ? `${shareSource(shared)}. Its ${name} subtitles become a text under the video, translated like the texts written for you, and you can tap any word.`
            : `Paste a YouTube video's link. Its ${name} subtitles become a text under the video, translated like the texts written for you, and you can tap any word.`}
        </Help>
        <Select
          label="Language"
          options={TEXT_LANGUAGE_ORDER.map(flaggedName)}
          value={flaggedName(language)}
          onChange={(v) => { const picked = TEXT_LANGUAGE_ORDER.find((l) => flaggedName(l) === v); if (picked) setLanguage(picked); }}
        />
        <Field
          label="Link"
          placeholder="e.g. https://youtu.be/…"
          value={link}
          onChangeText={setLink}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={check}
        />
        {link.trim() && !id ? <Text style={{ ...type.footnote, color: c.danger }}>That isn't a link to a YouTube video.</Text> : null}
        {current ? <VideoPreviewCards preview={current} /> : preview ? <Help>You changed the link or the language. Check it again before adding it.</Help> : null}
        {error ? <ErrorNote message={error} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** What adding it would give: the video, how much is known, the new words, and the cost. */
function VideoPreviewCards({ preview }: { preview: VideoPreview }) {
  const c = useTheme();
  const note = coverageNote(preview);
  const more = moreNewWords(preview);
  return (
    <>
      <Card style={{ gap: space.xs }}>
        <Text style={{ ...type.headline, color: c.text }}>{preview.title}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>
          {[preview.channel, videoLength(preview.seconds), preview.generated ? "YouTube's automatic subtitles" : 'Subtitles by the channel'].filter(Boolean).join(' · ')}
        </Text>
        {preview.generated ? <Help>Automatic subtitles can mishear a word, and have no punctuation, so lines are joined where they look too short.</Help> : null}
      </Card>
      <Card style={{ gap: space.s }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>Words you know</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }} accessible accessibilityLabel={`${percentKnown(preview)} of the words in it`}>
          <Text style={{ ...type.title, fontSize: 30, color: c.text, fontVariant: ['tabular-nums'] }}>{percentKnown(preview)}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>of the words in it</Text>
        </View>
        <Meter value={preview.coverage} color={c.accent} />
        {note ? <Help>{note}</Help> : null}
      </Card>
      <Card style={{ gap: space.s }}>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{newWordsTitle(preview)}</Text>
        {preview.new_words.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 }}>
            {preview.new_words.map((w) => (
              <Text key={w} style={{ ...type.subhead, color: c.text, backgroundColor: c.fill, borderRadius: radius.s, overflow: 'hidden', paddingHorizontal: space.s, paddingVertical: 3 }}>{w}</Text>
            ))}
            {more ? <Text style={{ ...type.subhead, color: c.textSecondary, paddingHorizontal: space.s, paddingVertical: 3 }}>{`+${more}`}</Text> : null}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
          <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{`${preview.lines} lines, translating`}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{costText(preview.cost_usd)}</Text>
        </View>
      </Card>
    </>
  );
}
