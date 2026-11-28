import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { scriptLanguage } from '../core/shareInbox';
import { ApiError, type GlossLanguage, type ReadingLine, type Word } from '../reader/api';
import { glossInfo } from '../reader/languages';
import { canAdd, formOf, lookedUpWords, lookUpStatus, wordIn } from '../reader/lookUp';
import { saidAs } from '../reader/wordAudio';
import { Button, Card, ErrorNote, Field, Help, Screen, Select } from './kit';
import { glossText } from './lookUpCache';
import { radius, readable, space, type, useTheme } from './theme';
import type { CardGlossing } from './useCardGlosses';
import { IpaPill } from './IpaPill';
import { ipaGuideFor } from '../tools/ipaGuide';
import { useKeyboardScroll } from './useKeyboardScroll';

/** The language last looked up in, for the next time the screen opens. */
let lastLanguage: GlossLanguage | undefined;

const nameOf = (l: GlossLanguage) => {
  const info = glossInfo(l);
  return `${info.flag} ${info.name}`;
};

/**
 * Look up (src/reader/lookUp.ts): a word or a few, typed, pasted or shared from another app (`initial`),
 * glossed by Read & Listen's server as a card's sentence is: each word's dictionary form, meaning (asked
 * of Claude for one nothing has), where it stands in the deck, a line from the learner's reading that
 * uses it, Hear it and Add to deck. Kept on the phone once looked up, so it shows offline. Needs Read &
 * Listen (`glossing`); without it the screen says so. Nothing here grades a card.
 */
export function LookUp({ glossing, initial, toolbar, readerLanguage }: {
  glossing: CardGlossing | undefined;
  /** Text shared to Franki to look up (useShareInbox). */
  initial?: string;
  /** Read & Listen's language, the default when the text's script names none. */
  readerLanguage?: GlossLanguage;
  toolbar: React.ReactNode;
}) {
  const languages = Object.keys(glossing?.glossDecks ?? {}) as GlossLanguage[];
  const pick = (l: GlossLanguage | undefined) => (l && languages.includes(l) ? l : undefined);
  const [language, setLanguage] = useState<GlossLanguage | undefined>(
    () => pick(initial ? scriptLanguage(initial) : undefined) ?? pick(lastLanguage) ?? pick(readerLanguage) ?? languages[0],
  );
  const [text, setText] = useState(initial ?? '');
  const [found, setFound] = useState<{ text: string; language: GlossLanguage; words: Word[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const { scrollProps, bottomPadding } = useKeyboardScroll();

  const lookUp = async (what = text, lang = language) => {
    const asked = what.trim();
    if (!glossing || !lang || !asked) return;
    Keyboard.dismiss();
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    lastLanguage = lang;
    try {
      const glossed = await glossText(glossing.api, lang, asked);
      // A newer lookup was asked for meanwhile: this one's answer is dropped.
      if (mine !== seq.current) return;
      const words = glossed ? lookedUpWords(glossed) : [wordIn([], asked)];
      setFound({ text: asked, language: lang, words });
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e.message : "Couldn't look that up. Read & Listen couldn't be reached, and it wasn't looked up before.");
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };
  // Opened with shared text: looked up straight away.
  useEffect(() => { if (initial) void lookUp(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen title="Look up" largeTitle={false} toolbar={toolbar}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.l + bottomPadding, gap: space.m }}
        {...scrollProps}
      >
        {!glossing || !language ? (
          <Help>Look up uses Read & Listen to find a word's meaning. Turn it on in Settings, Read & Listen.</Help>
        ) : (
          <>
            <Field
              label="A word or a few"
              placeholder="e.g. pieszych"
              value={text}
              onChangeText={setText}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => void lookUp()}
              keyboardLanguage={glossInfo(language).speech}
            />
            {languages.length > 1 ? (
              <Select
                label="Language"
                options={languages.map(nameOf)}
                value={nameOf(language)}
                onChange={(v) => {
                  const l = languages.find((x) => nameOf(x) === v);
                  if (l) { setLanguage(l); if (found) void lookUp(found.text, l); }
                }}
              />
            ) : null}
            <Button label="Look it up" onPress={() => void lookUp()} busy={busy} busyLabel="Looking it up" disabled={!text.trim()} />
            {error ? <ErrorNote message={error} /> : null}
            {found && found.language === language ? found.words.map((w, i) => (
              <WordCard key={`${found.text}|${i}`} word={w} language={found.language} glossing={glossing} />
            )) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** One word: its dictionary form, meaning, where it stands, a line from the learner's reading, and Hear it and Add to deck. */
function WordCard({ word, language, glossing }: { word: Word; language: GlossLanguage; glossing: CardGlossing }) {
  const c = useTheme();
  const [meaning, setMeaning] = useState<string | null | undefined>(word.gloss ?? undefined);
  const [line, setLine] = useState<ReadingLine | null>(null);

  useEffect(() => {
    let live = true;
    if (!word.gloss) {
      glossing.api.wordMeaning(language, word.text).then((m) => { if (live) setMeaning(m); }).catch(() => { if (live) setMeaning(null); });
    }
    if (language !== 'tok') {
      const asked = word.lemma ?? word.text;
      glossing.api.readingLines(language, [asked]).then((lines) => { if (live) setLine(lines[asked]?.[0] ?? null); }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [word, language, glossing.api]);

  const form = formOf(word);
  const pronunciation = word.translit ?? (word.ipa ? `/${word.ipa}/` : null);
  return (
    <Card style={{ gap: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.s }}>
        <Text selectable style={{ ...type.title, color: c.text, flexShrink: 1 }}>{word.lemma && form ? word.lemma : word.text}</Text>
        {pronunciation && !word.translit && ipaGuideFor(language) ? <IpaPill ipa={pronunciation} language={ipaGuideFor(language)!} />
          : pronunciation ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{pronunciation}</Text> : null}
      </View>
      <Text style={{ ...type.body, color: meaning === null ? c.textSecondary : c.text }}>
        {meaning === undefined ? 'Looking up the meaning' : meaning ?? "Couldn't find a meaning for it."}
      </Text>
      {form ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${word.text}: ${form.toLowerCase()}.`}</Text> : null}
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: space.s, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: c.fill }}>
        <Text style={{ ...type.caption, fontWeight: '600', color: c.textSecondary }}>{lookUpStatus(word)}</Text>
      </View>
      {line ? <Help>{`From your reading, ${line.title}: ${line.line}`}</Help> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <Button size="small" variant="secondary" icon="play.fill" label="Hear it" style={{ flex: 1 }} onPress={() => glossing.onPlayWord(word.text, language, saidAs(language, word.text, word.translit))} />
        {canAdd(word) ? (
          <Button size="small" icon="plus.circle" label="Add to deck" style={{ flex: 1 }} onPress={() => void glossing.onAddWord(word.text, meaning ?? '', language, { ipa: word.ipa, ipa_source: word.ipa_source, translit: word.translit })} />
        ) : null}
      </View>
    </Card>
  );
}

