import { useAudioPlayer } from 'expo-audio';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { compareTyped } from '../core/typedCompare';
import type { Api, ReaderText } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { drillLines, lineText, markLine, roundLine, roundProgress, roundScore, startRound, type LineDrillKind } from '../reader/lineDrill';
import { prefs } from '../reader/storage';
import { haptic } from './haptics';
import { Button, Card, Chip, Help, Icon, NavRow, Tappable } from './kit';
import { Reveal } from './motion';
import type { ReadTextStyle } from './ReadWord';
import { RecordYourself } from './RecordYourself';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { TypedDiff } from './TypedDiff';
import { useKeyboardScroll } from './useKeyboardScroll';
import { useSelfRecording } from './useSelfRecording';

const AUDIO_MODE = { playsInSilentMode: true, shouldPlayInBackground: true };
/** Write what you hear's slower speed, the reader's own slowest. */
const SLOW = 0.7;

/**
 * Using the lines of a text just read (reader/lineDrill.ts), in place of the end view until it's
 * done or left: Say it back shows a line's English, to say aloud or type in the language; Write
 * what you hear plays a line to type. Check shows the line against what was typed, and the reader
 * marks it Missed it or Got it; a missed line comes back at the end. Nothing is logged or graded.
 */
export function ReadLineDrill({ api, text, kind, textStyle, explain, onDone }: {
  api: Api;
  text: ReaderText;
  kind: LineDrillKind;
  textStyle: ReadTextStyle;
  /** A line's explanation, as the reader shows it under the line. */
  explain: (line: number) => React.ReactNode;
  onDone: () => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [round, setRound] = useState(() => startRound(drillLines(text, kind)));
  const at = roundLine(round);
  const line = at === undefined ? undefined : text.lines[at];
  const [typed, setTyped] = useState('');
  const [checked, setChecked] = useState(false);
  const [explaining, setExplaining] = useState(false);
  const [rate, setRate] = useState(kind === 'hear' ? SLOW : prefs().rate);
  const [plays, setPlays] = useState(0);
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const self = useSelfRecording(at === undefined ? null : `${text.id}:drill:${round.at}`, AUDIO_MODE, { onBeforeAudio: () => player.pause() });
  // The keyboard's height pads the whole screen, so Check and the marks under the list stay above it (as in FormsDrill).
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();

  const play = (r = rate) => {
    if (at === undefined || !line?.audio) return;
    self.stop(false);
    player.replace(api.audioSource(text.id, at));
    player.setPlaybackRate(r, 'high');
    player.play();
    setPlays((n) => n + 1);
  };
  // Each line starts with an empty box; Write what you hear plays it as it comes up.
  useEffect(() => {
    setTyped('');
    setChecked(false);
    setExplaining(false);
    setPlays(0);
    if (kind === 'hear') play();
  }, [round.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const expected = line ? lineText(line) : '';
  const comparison = useMemo(() => compareTyped(expected, typed), [expected, typed]);
  const check = () => {
    haptic.tap();
    setChecked(true);
    if (kind === 'say') play();
  };
  const mark = (right: boolean) => {
    haptic.answer();
    player.pause();
    setRound((r) => markLine(r, right));
  };

  if (at === undefined || !line) {
    const { right, asked } = roundScore(round);
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.xl }}>
          <Text accessibilityRole="header" style={{ ...type.largeTitle, color: c.accent, fontVariant: ['tabular-nums'] }}>{`${right} of ${asked}`}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary }}>right the first time</Text>
        </Card>
        <Button label="Done" onPress={onDone} />
      </ScrollView>
    );
  }

  const progress = roundProgress(round);
  const back = round.queue.slice(0, round.at).includes(at);
  const readFont = { fontSize: textStyle.fontSize, lineHeight: textStyle.lineHeight, fontFamily: textStyle.font.fontFamily };
  const speaker = line.speaker === 'N' ? null : text.roles[line.speaker] ?? (line.speaker === 'A' ? 'Speaker A' : 'Speaker B');
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        {...scrollProps}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{`Line ${progress.done} of ${progress.total}`}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{back ? 'Missed earlier' : kind === 'say' ? 'Say it back' : 'Write what you hear'}</Text>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.total, now: progress.done - 1 }} style={{ height: 4, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${((progress.done - 1) / progress.total) * 100}%`, backgroundColor: c.accent }} />
        </View>
        <Reveal key={round.at} rise={10} style={{ gap: space.m }}>
          {kind === 'say' ? (
            <Card style={{ gap: space.s, paddingVertical: space.l }}>
              {speaker ? <Text style={{ ...type.footnote, fontWeight: '600', color: c.textSecondary }}>{speaker}</Text> : null}
              <Text selectable style={{ ...type.cardBack, color: c.text }}>{line.english}</Text>
              <Help>{`Say it in ${LANGUAGES[text.language].name}, out loud or typed below, then check.`}</Help>
            </Card>
          ) : (
            <Card style={{ alignItems: 'center', gap: space.m, paddingVertical: space.l }}>
              <Tappable
                onPress={() => { haptic.tap(); play(); }}
                accessibilityRole="button"
                accessibilityLabel="Play the line again"
                style={{ width: 72, height: 72, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="play.fill" size={28} color={c.onAccent} />
              </Tappable>
              <View style={{ flexDirection: 'row', gap: space.s }}>
                <Chip label={`${SLOW}×`} selected={rate === SLOW} onPress={() => { setRate(SLOW); play(SLOW); }} />
                <Chip label="1×" selected={rate === 1} onPress={() => { setRate(1); play(1); }} />
              </View>
              {plays > 1 ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{`Played ${plays} times`}</Text> : null}
            </Card>
          )}
          {checked ? (
            <Card style={{ gap: space.m }}>
              {typed.trim() ? <TypedDiff comparison={comparison} showExpected={false} size="body" lang={LANGUAGES[text.language].speech} /> : null}
              {typed.trim() ? <View style={{ height: hairline, backgroundColor: c.border }} /> : null}
              <View style={{ gap: space.xs }}>
                <Text style={{ ...type.overline, color: c.textSecondary }}>The line</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
                  <Text selectable accessibilityLanguage={LANGUAGES[text.language].speech} style={{ ...readFont, fontWeight: '600', color: c.text, flex: 1 }}>
                    {typed.trim() ? comparison.expected.map((p, i) => (p.kind === 'same' ? p.text : (
                      <Text key={i} style={{ color: c.good, backgroundColor: c.goodFill }}>{p.text}</Text>
                    ))) : expected}
                  </Text>
                  {line.audio ? (
                    <Tappable
                      onPress={() => { haptic.tap(); play(); }}
                      accessibilityRole="button"
                      accessibilityLabel="Play the line"
                      style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Icon name="play.fill" size={16} color={c.accent} />
                    </Tappable>
                  ) : null}
                </View>
                {kind === 'hear' ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{line.english}</Text> : null}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {kind === 'say' ? <RecordYourself rec={self} label="Record" size="player" /> : null}
                <Chip label="Explain" selected={explaining} onPress={() => setExplaining(!explaining)} />
              </View>
              {explaining ? explain(at) : null}
            </Card>
          ) : (
            <TextInput
              value={typed}
              onChangeText={setTyped}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              placeholder={kind === 'say' ? 'Type it, or just say it' : 'Type what you heard'}
              accessibilityLabel={kind === 'say' ? 'Type the line' : 'Type what you heard'}
              placeholderTextColor={c.textTertiary}
              selectionColor={c.accent}
              keyboardAppearance={dark ? 'dark' : 'light'}
              style={{
                ...readFont, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
                borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP * 2,
              }}
            />
          )}
          {checked ? <Help>A line you miss comes back at the end of the round.</Help> : null}
        </Reveal>
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.l }}>
        {checked ? (
          <>
            <Button variant="secondary" label="Missed it" style={{ flex: 1 }} onPress={() => mark(false)} />
            <Button label="Got it" style={{ flex: 1 }} onPress={() => mark(true)} />
          </>
        ) : (
          <>
            <Button variant="secondary" label="Stop" style={{ flex: 1 }} onPress={() => { player.pause(); onDone(); }} />
            <Button label={typed.trim() ? 'Check' : 'Show the line'} style={{ flex: 2 }} onPress={check} />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * In the end view: the two ways to use the text's lines, each with how many lines it would ask.
 * Shown when there's at least one line to ask.
 */
export function LineDrillCard({ text, onStart, onRetell }: { text: ReaderText; onStart: (kind: LineDrillKind) => void; onRetell: () => void }) {
  const c = useTheme();
  const say = drillLines(text, 'say').length;
  const hear = drillLines(text, 'hear').length;
  const name = LANGUAGES[text.language].name;
  return (
    <Card style={{ gap: space.s }}>
      <Text accessibilityRole="header" style={{ ...type.title, color: c.text }}>Use the lines yourself</Text>
      <Help>Make this text's lines yourself, then compare with the original, or tell the whole of it again. Nothing here is graded.</Help>
      <View style={{ borderRadius: radius.m, ...smooth, borderWidth: hairline, borderColor: c.border, overflow: 'hidden' }}>
        {say ? (
          <NavRow first icon={{ name: 'mic.fill', color: c.teal }} label="Say it back" detail={`See a line in English, say or type it in ${name}. ${say} ${say === 1 ? 'line' : 'lines'}.`} onPress={() => onStart('say')} />
        ) : null}
        {hear ? (
          <NavRow first={!say} icon={{ name: 'waveform', color: c.rose }} label="Write what you hear" detail={`Hear a line, type it, see what was off. ${hear} ${hear === 1 ? 'line' : 'lines'}.`} onPress={() => onStart('hear')} />
        ) : null}
        <NavRow icon={{ name: 'text.alignleft', color: c.violet }} label="Retell it" detail="Tell the story in a few sentences of your own. Claude points out what to fix and words from the text you could use." onPress={onRetell} />
      </View>
    </Card>
  );
}
