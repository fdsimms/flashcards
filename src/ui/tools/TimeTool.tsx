import * as Speech from 'expo-speech';
import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import type { Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import type { Phrase } from '../../tools/phrase';
import { MINUTE_STEPS, randomTime, type ClockTime, type MinuteStep } from '../../tools/time';
import { TIME_SAYERS, toolLanguage } from '../../tools/tools';
import { loadToolPrefs, saveToolPrefs, toolPrefs } from '../../tools/storage';
import { haptic } from '../haptics';
import { Button, Card, Help, Icon, Screen, Segments, Tappable } from '../kit';
import { usePhoneSpeech } from '../usePhoneSpeech';
import { radius, space, type, useTheme } from '../theme';
import { ClockFace } from './ClockFace';
import type { ToolScreenProps } from './index';
import { useWheelRow, Wheel, WheelBand, wheelScale } from './Wheel';

const STEP_LABELS: Record<MinuteStep, string> = { 1: 'Any minute', 5: '5 min', 15: '15 min', 30: '30 min' };

/**
 * Telling the time: a clock and hour and minute wheels, set by scrolling or at random, then the
 * answer in the language chosen in the header's menu (the usual way to say it, read aloud in the
 * voice chosen in Settings, Voices; other ways it's said; the 24-hour form). Changing the time
 * hides the answer again.
 */
export function TimeTool({ tool, repo }: ToolScreenProps) {
  const c = useTheme();
  const { fontScale } = useWindowDimensions();
  const row = useWheelRow();
  const speech = usePhoneSpeech(repo);
  const [language, setLanguage] = useState<Language>(() => toolLanguage(tool, toolPrefs().language));
  const [step, setStep] = useState<MinuteStep>(() => toolPrefs().minuteStep);
  const [time, setTime] = useState<ClockTime>(() => randomTime(toolPrefs().minuteStep));
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let live = true;
    loadToolPrefs().then((p) => { if (live) { setLanguage(toolLanguage(tool, p.language)); setStep(p.minuteStep); } });
    return () => { live = false; Speech.stop(); };
  }, [tool]);

  const say = TIME_SAYERS[language];
  const saying = useMemo(() => say?.(time), [say, time]);
  const speak = (p: Phrase) => { Speech.stop(); speech.sayWord(p.text, LANGUAGES[language].speech); };

  const change = (next: ClockTime) => { Speech.stop(); setShown(false); setTime(next); };
  const chooseLanguage = (l: Language) => { setLanguage(l); saveToolPrefs({ language: l }); Speech.stop(); setShown(false); };
  const chooseStep = (s: MinuteStep) => { haptic.select(); setStep(s); saveToolPrefs({ minuteStep: s }); };
  const reveal = () => {
    if (shown) { Speech.stop(); setShown(false); return; }
    setShown(true);
    if (saying) speak(saying.everyday);
  };

  const name = LANGUAGES[language].name;
  return (
    <Screen
      title={tool.title}
      largeTitle={false}
      toolbar={tool.languages.length > 1 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu title="Language" accessibilityLabel={`Language: ${name}. Change the language`}>
            <Stack.Toolbar.Label>{name}</Stack.Toolbar.Label>
            {tool.languages.map((l) => (
              <Stack.Toolbar.MenuAction key={l} isOn={l === language} onPress={() => chooseLanguage(l)}>{LANGUAGES[l].name}</Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : undefined}
      footer={(
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button variant="secondary" label="Randomize" style={{ flex: 1 }} onPress={() => change(randomTime(step, time))} />
          <Button label={shown ? 'Hide answer' : 'Show answer'} style={{ flex: 1 }} onPress={reveal} />
        </View>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.l }}>
        <Card style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: space.l }}>
          <ClockFace time={time} size={Math.max(128, row * 3)} />
          <WheelBand>
            <Wheel label="Hour" count={24} value={time.hour} width={64 * wheelScale(fontScale)} onChange={(hour) => change({ ...time, hour })} />
            <Text maxFontSizeMultiplier={2} style={{ ...type.title, fontSize: 28, color: c.text, paddingBottom: 3 }}>:</Text>
            <Wheel label="Minute" count={60} value={time.minute} width={64 * wheelScale(fontScale)} onChange={(minute) => change({ ...time, minute })} />
          </WheelBand>
        </Card>

        <View style={{ gap: space.s }}>
          <Text style={{ ...type.overline, color: c.textSecondary, paddingHorizontal: space.xs }}>Random times</Text>
          <Segments options={MINUTE_STEPS.map((s) => ({ value: s, label: STEP_LABELS[s] }))} value={step} onChange={chooseStep} />
        </View>

        <Card style={{ minHeight: 120 }}>
          {!shown || !saying ? (
            <Help>Say the time in {name} out loud, then show the answer.</Help>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text selectable style={{ ...type.cardBack, color: c.text }}>{saying.everyday.text}</Text>
                  {saying.everyday.roman ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{saying.everyday.roman}</Text> : null}
                </View>
                <Tappable
                  onPress={() => { haptic.tap(); speak(saying.everyday); }}
                  accessibilityRole="button"
                  accessibilityLabel="Play"
                  hitSlop={6}
                  style={{ width: 40, height: 40, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
                </Tappable>
              </View>
              {saying.also.length ? <Ways title="Also said" phrases={saying.also} onPlay={speak} /> : null}
              <Ways title="Formal" phrases={[saying.formal]} onPlay={speak} />
            </>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

/** Other ways to say it, under a small heading: each tappable to hear it. */
function Ways({ title, phrases, onPlay }: { title: string; phrases: Phrase[]; onPlay: (p: Phrase) => void }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.s, borderTopWidth: 0.5, borderTopColor: c.border, paddingTop: space.m }}>
      <Text style={{ ...type.overline, color: c.textSecondary }}>{title}</Text>
      {phrases.map((p) => (
        <Tappable key={p.text} onPress={() => { haptic.tap(); onPlay(p); }} accessibilityRole="button" accessibilityHint="Plays it" scaleTo={0.99} style={{ gap: 2 }}>
          <Text style={{ ...type.body, color: c.text }}>{p.text}</Text>
          {p.roman || p.note ? (
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{[p.roman, p.note].filter(Boolean).join(' · ')}</Text>
          ) : null}
        </Tappable>
      ))}
    </View>
  );
}
