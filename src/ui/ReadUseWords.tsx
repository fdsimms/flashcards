import React, { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { failureText } from '../core/failure';
import type { Api, Language, WritingCheck } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import type { WordToUse } from '../reader/production';
import { Button, Card, ErrorNote, Help, Screen } from './kit';
import { WritingResult } from './ReadWritingResult';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Use today's words (reader/production.ts): after a review session, each word learned in it, one at a
 * time, to write a sentence of one's own with. Check asks Claude on Read & Listen's server, which
 * corrects it and says what changed; nothing is kept, and no card's schedule changes.
 */
export function ReadUseWords({ api, language, words, onPlay, onDone }: {
  api: Api;
  language: Language;
  words: WordToUse[];
  /** Reads a sentence aloud in the language. */
  onPlay: (text: string) => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const name = LANGUAGES[language].name;
  const [at, setAt] = useState(0);
  const [attempt, setAttempt] = useState('');
  const [check, setCheck] = useState<WritingCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [written, setWritten] = useState(0);
  // Which word a check was asked for: one that comes back after Skip or Next was tapped isn't shown on the next word.
  const asking = useRef(0);
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const word = words[at];

  const next = () => {
    asking.current++;
    setAt(at + 1);
    setAttempt('');
    setCheck(null);
    setError(null);
    setChecking(false);
  };
  const ask = async () => {
    if (!word || checking || !attempt.trim()) return;
    const mine = ++asking.current;
    setChecking(true);
    setError(null);
    try {
      const answer = await api.checkWriting({ kind: 'sentence', language, attempt: attempt.trim(), word: word.word, meaning: word.meaning });
      if (asking.current !== mine) return;
      setCheck(answer);
      setWritten((n) => n + 1);
    } catch (e) {
      if (asking.current === mine) setError(failureText(e, { what: "Couldn't check your sentence.", next: 'Try again.' }));
    } finally {
      if (asking.current === mine) setChecking(false);
    }
  };

  if (!word) {
    return (
      <Screen title="Use today's words" largeTitle={false} footer={<Button label="Done" onPress={onDone} />}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.m }}>
          <Card style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.xl }}>
            <Text style={{ ...type.largeTitle, color: c.accent, fontVariant: ['tabular-nums'] }}>{written}</Text>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>{written === 1 ? 'sentence written' : 'sentences written'}</Text>
          </Card>
          <Help>Writing a word into a sentence of your own is one of the best ways to keep it. Nothing here changes when its cards come back.</Help>
        </ScrollView>
      </Screen>
    );
  }

  const footer = check ? (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      <Button variant="secondary" label="Try again" style={{ flex: 1 }} onPress={() => { asking.current++; setCheck(null); }} />
      <Button label={at + 1 < words.length ? 'Next word' : 'Done'} style={{ flex: 1 }} onPress={next} />
    </View>
  ) : (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      <Button variant="secondary" label="Skip" style={{ flex: 1 }} onPress={next} />
      <Button label="Check" style={{ flex: 2 }} busy={checking} disabled={!attempt.trim()} onPress={ask} />
    </View>
  );
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <Screen title="Use today's words" largeTitle={false} footer={footer}>
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.l, gap: space.m }} {...scrollProps}>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Word ${at + 1} of ${words.length}`}</Text>
          <Card style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.l }}>
            <Text style={{ ...type.subhead, color: c.textSecondary }}>Write a sentence with</Text>
            <Text selectable accessibilityLanguage={LANGUAGES[language].speech} style={{ ...type.cardFront, color: c.text, textAlign: 'center' }}>{word.word}</Text>
            <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>{word.meaning}</Text>
          </Card>
          {check ? (
            <Card><WritingResult check={check} attempt={attempt} lang={LANGUAGES[language].speech} onPlay={() => onPlay(check.corrected)} /></Card>
          ) : (
            <>
              <TextInput
                value={attempt}
                onChangeText={setAttempt}
                multiline
                autoCorrect={false}
                spellCheck={false}
                placeholder={`Your sentence, in ${name}`}
                accessibilityLabel={`Your sentence with ${word.word}, in ${name}`}
                placeholderTextColor={c.textTertiary}
                selectionColor={c.accent}
                keyboardAppearance={dark ? 'dark' : 'light'}
                style={{
                  ...type.body, fontSize: 20, lineHeight: 28, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
                  borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP * 2,
                }}
              />
              <Help>Any form of the word counts. Claude checks it on Read & Listen's server.</Help>
            </>
          )}
          {error ? <ErrorNote message={error} onRetry={ask} /> : null}
        </ScrollView>
      </Screen>
    </View>
  );
}
