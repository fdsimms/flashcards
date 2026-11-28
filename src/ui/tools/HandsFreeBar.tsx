import React, { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { Animated, Easing, Text, View } from 'react-native';
import { handsFreeStatus, REVIEW_MS } from '../../reader/handsFree';
import { haptic } from '../haptics';
import { Button, Help, Icon, Tappable } from '../kit';
import { radius, smooth, space, type, useTheme } from '../theme';
import { useSpokenAnswer } from '../useSpokenAnswer';
import type { useHandsFree } from './useHandsFree';

type HandsFreeRun = ReturnType<typeof useHandsFree>;

/**
 * Hands-free Situations' footer (src/reader/handsFree.ts): what's happening now, the line as it's heard,
 * the line waiting to be sent with its bar (a tap opens it to fix), then Say it in English (held) and
 * Pause or Resume. While a line is being fixed, `typing` (the conversation's own box) shows above them.
 */
export function HandsFreeBar({ run, name, lang, look, typing }: {
  run: HandsFreeRun;
  name: string;
  /** The scene's language for VoiceOver (th-TH). */
  lang: string;
  look: { fontSize: number; lineHeight: number; fontFamily?: string };
  typing: React.ReactNode;
}) {
  const c = useTheme();
  const { state } = run;
  const paused = state.step === 'paused';
  const icon = state.step === 'listening' ? 'mic.fill' : state.step === 'theirs' ? 'speaker.wave.2.fill' : paused ? 'pause.fill' : 'ellipsis';
  const tint = state.step === 'listening' ? c.accent : state.step === 'theirs' ? c.goodInk : c.textSecondary;
  const fill = state.step === 'listening' ? c.accentFill : c.fill;

  // The review's wait, as a bar that empties as the line is sent.
  const left = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (state.step !== 'review') return;
    left.setValue(1);
    const run_ = Animated.timing(left, { toValue: 0, duration: REVIEW_MS, easing: Easing.linear, useNativeDriver: false });
    run_.start();
    return () => run_.stop();
  }, [state.step, state.line, left]);

  return (
    <View style={{ gap: space.s }}>
      <View accessible accessibilityLiveRegion="polite" accessibilityLabel={handsFreeStatus(state, name)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <View style={{ width: 44, height: 44, borderRadius: radius.pill, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={tint} />
        </View>
        <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{handsFreeStatus(state, name)}</Text>
      </View>
      {state.step === 'review' ? (
        <Tappable
          onPress={() => { haptic.select(); run.fix(); }}
          accessibilityRole="button"
          accessibilityLabel={`${state.line}. Tap to fix it before it's sent`}
          scaleTo={0.99}
          style={{ backgroundColor: c.accentFill, borderRadius: radius.l, ...smooth, padding: space.m, gap: space.s }}
        >
          <Text accessibilityLanguage={lang} style={{ ...look, color: c.text }}>{state.line}</Text>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: c.fill, overflow: 'hidden' }}>
            <Animated.View style={{ height: 4, backgroundColor: c.accent, width: left.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
          </View>
        </Tappable>
      ) : state.step === 'listening' && state.line ? (
        <Tappable onPress={() => { haptic.select(); run.fix(); }} accessibilityRole="button" accessibilityLabel={`${state.line}. Tap to type it instead`} style={{ padding: space.s }}>
          <Text accessibilityLanguage={lang} style={{ ...look, color: c.textSecondary }}>{state.line}</Text>
        </Tappable>
      ) : null}
      {paused && state.paused === 'fixing' ? typing : null}
      {run.problem ? <Text style={{ ...type.footnote, color: c.danger }}>{run.problem}</Text> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {run.englishAvailable ? (
          <Tappable
            onPressIn={run.englishStart}
            onPressOut={() => { haptic.tap(); run.englishEnd(); }}
            disabled={state.step !== 'listening'}
            restOpacity={state.step !== 'listening' ? 0.45 : 1}
            accessibilityRole="button"
            accessibilityLabel="Hold to say a word in English"
            accessibilityHint="The word goes in your line in brackets"
            scaleTo={0.98}
            style={{ flex: 1, minHeight: 52, borderRadius: radius.pill, borderWidth: 1.5, borderColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.m }}
          >
            <Text style={{ ...type.callout, fontWeight: '600', color: c.accentInk }}>Hold: say it in English</Text>
          </Tappable>
        ) : null}
        <Tappable
          onPress={() => { haptic.select(); if (paused) run.resume(); else run.pause(); }}
          accessibilityRole="button"
          accessibilityLabel={paused ? 'Resume' : 'Pause'}
          scaleTo={0.98}
          style={{ flex: run.englishAvailable ? 0 : 1, minWidth: 110, minHeight: 52, borderRadius: radius.pill, backgroundColor: paused ? c.accent : c.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.l, flexDirection: 'row', gap: space.xs }}
        >
          <Icon name={paused ? 'play.fill' : 'pause.fill'} size={14} color={paused ? c.onAccent : c.text} />
          <Text style={{ ...type.callout, fontWeight: '600', color: paused ? c.onAccent : c.text }}>{paused ? 'Resume' : 'Pause'}</Text>
        </Tappable>
      </View>
    </View>
  );
}

const NOTHING = () => undefined;

/**
 * Talk hands-free, beside a scene's Start. It needs Answer by speaking for the scene's language
 * (`speech`); without it the button says so and opens Settings, Speaking.
 */
export function HandsFreeStart({ speech, disabled, onStart }: { speech: string; disabled?: boolean; onStart: () => void }) {
  const hearing = useSpokenAnswer(speech, { onHeard: NOTHING });
  if (!hearing.available) {
    return (
      <View style={{ gap: space.xs }}>
        <Button variant="secondary" label="Talk hands-free" onPress={() => router.push('/speaking')} />
        <Help>Talking hands-free needs Answer by speaking for this language. Tap to open Settings, Speaking.</Help>
      </View>
    );
  }
  return <Button variant="secondary" label="Talk hands-free" disabled={disabled} onPress={() => { haptic.tap(); onStart(); }} />;
}
