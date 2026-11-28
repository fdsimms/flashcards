import React, { useState } from 'react';
import { Keyboard, ScrollView, Text, TextInput, useColorScheme, View } from 'react-native';
import { type Api, ApiError, GlossLanguage, type Language, MAX_OWN_TITLE_CHARS, type OwnTextPreview } from '../../reader/api';
import { flaggedName, glossInfo, isGlossOnly, TEXT_LANGUAGE_ORDER } from '../../reader/languages';
import { scriptLanguage, shareSource, type SharedItem } from '../../core/shareInbox';
import { charCount, costText, coverageNote, listenTime, moreNewWords, newWordsTitle, partsNote, percentKnown, tooLong } from '../../reader/ownText';
import { haptic } from '../haptics';
import { Button, Card, ErrorNote, Field, Help, Meter, Screen, Select } from '../kit';
import { hairline, MIN_TAP, radius, readable, smooth, space, type, useTheme } from '../theme';
import { useKeyboardScroll } from '../useKeyboardScroll';

/**
 * A text of the learner's own, pasted in to read in Read & Listen (server/reader own_text.py): an
 * article, a chapter, song lyrics. Check shows what adding it would give, against the deck as it is
 * now: how much of it is known, the words that aren't, and what translating and recording it costs.
 * Add to shelf sends it; it's translated and recorded in the background and joins the shelf's Your
 * texts row. Changing the text or title after a check asks for another, so what's added is what was
 * shown. Opened from New text's Your own text (ReadWrite.tsx), or with text shared from another app
 * (`shared`, src/core/shareInbox.ts), which fills it in and sets the language from its script.
 * `toolbar` is that screen's Cancel.
 */
export function ReadOwnText({ api, language: readerLanguage, shared, toolbar, onDone }: { api: Api; language: GlossLanguage; shared?: SharedItem; toolbar: React.ReactNode; onDone: () => void }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [language, setLanguage] = useState<GlossLanguage>(() => {
    const guess = shared ? scriptLanguage(shared.text) : undefined;
    return guess && TEXT_LANGUAGE_ORDER.includes(guess) ? guess : readerLanguage;
  });
  const [title, setTitle] = useState(shared?.title ?? '');
  const [text, setText] = useState(shared?.text ?? '');
  // The preview, with what it was made from, so an edit after it asks for a new one.
  const [preview, setPreview] = useState<{ language: GlossLanguage; text: string; title: string; found: OwnTextPreview } | null>(null);
  const [busy, setBusy] = useState<'check' | 'add' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const name = glossInfo(language).name;
  // Toki Pona has no voice, so its texts are read and never heard.
  const heard = isGlossOnly(language) ? '' : 'and read aloud ';
  const current = preview && preview.language === language && preview.text === text && preview.title === title ? preview.found : null;
  const over = tooLong(text.trim().length);

  const check = async () => {
    if (busy || !text.trim() || over) return;
    Keyboard.dismiss();
    setBusy('check');
    setError(null);
    const asked = { language, text, title };
    try {
      const found = await api.ownTextPreview(asked.language, asked.text, asked.title);
      setPreview({ ...asked, found });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check the text. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (busy || !current) return;
    setBusy('add');
    setError(null);
    try {
      await api.addOwnText(language, text, title);
      haptic.success();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add the text. Try again.");
      setBusy(null);
    }
  };

  const footer = current
    ? <Button label="Add to shelf" onPress={add} busy={busy === 'add'} busyLabel="Adding" />
    : <Button label="Check" onPress={check} busy={busy === 'check'} busyLabel="Checking" disabled={!text.trim() || over || busy !== null} />;

  return (
    <Screen title={`Your ${name} text`} largeTitle={false} toolbar={toolbar} footer={footer}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
      >
        {shared
          ? <Help>{`${shareSource(shared)}. It's translated ${heard}like the texts written for you, and you can tap any word.`}</Help>
          : <Help>{`Paste something you want to read in ${name}: an article, a chapter, song lyrics. It's translated ${heard}like the texts written for you, and you can tap any word.`}</Help>}
        <Select
          label="Language"
          options={TEXT_LANGUAGE_ORDER.map(flaggedName)}
          value={flaggedName(language)}
          onChange={(v) => { const picked = TEXT_LANGUAGE_ORDER.find((l) => flaggedName(l) === v); if (picked) setLanguage(picked); }}
        />
        <Field label="Title (optional)" placeholder="e.g. Nowy most w Krakowie" value={title} onChangeText={setTitle} maxLength={MAX_OWN_TITLE_CHARS} returnKeyType="next" />
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Text</Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoCorrect={false}
            spellCheck={false}
            placeholder={`Paste the ${name} text here`}
            accessibilityLabel={`The ${name} text`}
            placeholderTextColor={c.textTertiary}
            selectionColor={c.accent}
            keyboardAppearance={dark ? 'dark' : 'light'}
            style={{
              ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m, textAlignVertical: 'top',
              borderWidth: hairline, borderColor: over ? c.danger : c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP * 4, maxHeight: 320,
            }}
          />
          <Text style={{ ...type.footnote, color: over ? c.danger : c.textSecondary }}>
            {over ? `${charCount(text.trim().length)}. Add a shorter part, and the rest in another go.` : `${charCount(text.trim().length)}. Paste from Safari, an email or a book.`}
          </Text>
        </View>
        {current ? <PreviewCards preview={current} /> : preview ? <Help>You changed the text or its language. Check it again before adding it.</Help> : null}
        {error ? <ErrorNote message={error} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** What adding it would give: how much is known, the new words, and its size and cost. */
function PreviewCards({ preview }: { preview: OwnTextPreview }) {
  const c = useTheme();
  const note = coverageNote(preview);
  const more = moreNewWords(preview);
  const parts = partsNote(preview);
  return (
    <>
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
        {preview.new_count ? <Help>Tap a word while reading to add it to your deck.</Help> : null}
      </Card>
      <Card style={{ gap: space.xs }}>
        <Row label="Lines" value={String(preview.lines)} />
        <Row label="Read aloud" value={listenTime(preview.seconds)} />
        <Row label="Translating and recording" value={costText(preview.cost_usd)} />
        {parts ? <Help>{parts}</Help> : null}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.m }}>
      <Text style={{ ...type.subhead, color: c.text, flex: 1 }}>{label}</Text>
      <Text style={{ ...type.subhead, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
