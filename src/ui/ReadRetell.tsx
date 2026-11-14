import { useAudioPlayer } from 'expo-audio';
import React, { useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { failureText } from '../core/failure';
import type { Api, ReaderText, RetellCheck } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { lineText } from '../reader/lineDrill';
import { prefs } from '../reader/storage';
import { haptic } from './haptics';
import { Button, Card, ErrorNote, Help, Tappable } from './kit';
import { Reveal } from './motion';
import type { ReadTextStyle } from './ReadWord';
import { WritingResult } from './ReadWritingResult';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Retell it (reader/production.ts), in place of the end view until it's done or stopped: the text
 * just read, told again in a few sentences of one's own. Check asks Claude on the server, which
 * corrects the retelling, names words from the text it could have used (each opening the line it's
 * in) and what it left out. Nothing is kept or graded.
 */
export function ReadRetell({ api, text, textStyle, onDone }: {
  api: Api;
  text: ReaderText;
  textStyle: ReadTextStyle;
  onDone: () => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const name = LANGUAGES[text.language].name;
  const [attempt, setAttempt] = useState('');
  const [check, setCheck] = useState<RetellCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const asking = useRef(0);
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  // Its own player, as the check's: playing a line here isn't more of the reading.
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const onPlay = (line: number) => {
    if (!text.lines[line]?.audio) return;
    player.replace(api.audioSource(text.id, line));
    player.setPlaybackRate(prefs().rate, 'high');
    player.play();
  };
  const readFont = { fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily };

  const ask = async () => {
    if (checking || !attempt.trim()) return;
    const mine = ++asking.current;
    setChecking(true);
    setError(null);
    try {
      const answer = await api.retell(text.id, attempt.trim());
      if (asking.current === mine) setCheck(answer);
    } catch (e) {
      if (asking.current === mine) setError(failureText(e, { what: "Couldn't check your retelling.", next: 'Try again.' }));
    } finally {
      if (asking.current === mine) setChecking(false);
    }
  };

  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} {...scrollProps}>
        {check ? (
          <Reveal style={{ gap: space.m }}>
            <Card><WritingResult check={check} attempt={attempt} lang={LANGUAGES[text.language].speech} /></Card>
            {check.words.length ? (
              <Card style={{ gap: space.s }}>
                <Text style={{ ...type.overline, color: c.textSecondary }}>From the text, you could also use</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {check.words.map((w) => (
                    <Tappable
                      key={w.word}
                      onPress={() => { haptic.select(); setOpened(opened === w.line ? null : w.line); }}
                      accessibilityRole="button"
                      accessibilityLabel={`${w.word}, ${w.english}. Show the line it's in`}
                      accessibilityState={{ expanded: opened === w.line }}
                      hitSlop={{ top: space.xs, bottom: space.xs }}
                      style={{ minHeight: MIN_TAP - 8, justifyContent: 'center', paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: c.accentFill }}
                    >
                      <Text style={{ ...type.subhead, color: c.accent }}>{`${w.word} · ${w.english}`}</Text>
                    </Tappable>
                  ))}
                </View>
                {opened !== null && text.lines[opened] ? (
                  <Tappable
                    onPress={() => { haptic.tap(); onPlay(opened); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Line ${opened + 1}. Play it`}
                    style={{ backgroundColor: c.fill, borderRadius: radius.m, ...smooth, padding: space.m, gap: 2 }}
                  >
                    <Text style={{ ...type.overline, color: c.textSecondary }}>{`Line ${opened + 1}`}</Text>
                    <Text style={{ ...readFont, color: c.text }}>{lineText(text.lines[opened])}</Text>
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>{text.lines[opened].english}</Text>
                  </Tappable>
                ) : <Help>Tap one to see the line it's in.</Help>}
              </Card>
            ) : null}
            {check.left_out ? (
              <Card style={{ gap: space.xs }}>
                <Text style={{ ...type.overline, color: c.textSecondary }}>Left out</Text>
                <Text style={{ ...type.subhead, color: c.text }}>{check.left_out}</Text>
              </Card>
            ) : null}
          </Reveal>
        ) : (
          <>
            <Card style={{ gap: space.xs }}>
              <Text accessibilityRole="header" style={{ ...type.title, color: c.text }}>Retell it</Text>
              <Help>{`Tell what happens in ${text.title} in a few sentences of your own, in ${name}. Claude points out what to fix and words from the text you could use.`}</Help>
            </Card>
            <TextInput
              value={attempt}
              onChangeText={setAttempt}
              multiline
              autoCorrect={false}
              spellCheck={false}
              placeholder={`Your retelling, in ${name}`}
              accessibilityLabel={`Your retelling, in ${name}`}
              placeholderTextColor={c.textTertiary}
              selectionColor={c.accent}
              keyboardAppearance={dark ? 'dark' : 'light'}
              style={{
                ...readFont, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
                borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP * 4,
              }}
            />
          </>
        )}
        {error ? <ErrorNote message={error} onRetry={ask} /> : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.l }}>
        {check ? (
          <>
            <Button variant="secondary" label="Try again" style={{ flex: 1 }} onPress={() => { asking.current++; setCheck(null); setOpened(null); }} />
            <Button label="Done" style={{ flex: 1 }} onPress={onDone} />
          </>
        ) : (
          <>
            <Button variant="secondary" label="Stop" style={{ flex: 1 }} onPress={() => { asking.current++; onDone(); }} />
            <Button label="Check" style={{ flex: 2 }} busy={checking} disabled={!attempt.trim()} onPress={ask} />
          </>
        )}
      </View>
    </View>
  );
}
