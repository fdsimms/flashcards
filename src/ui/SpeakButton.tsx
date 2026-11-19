import React from 'react';
import { Text, View } from 'react-native';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';
import type { useSpokenAnswer } from './useSpokenAnswer';

type Spoken = ReturnType<typeof useSpokenAnswer>;

/**
 * The microphone beside a typing box (Answer by speaking, src/core/speaking.ts): tap to start, and
 * it stops by itself on a pause; tapped while listening, it stops. Nothing when speaking is off or
 * the language can't be heard on this iPhone. `label` names it for VoiceOver ("Say it").
 */
export function SpeakButton({ spoken, label = 'Say it', size = 'large' }: { spoken: Spoken; label?: string; size?: 'hero' | 'large' | 'small' }) {
  const c = useTheme();
  if (!spoken.available) return null;
  if (size === 'hero') return <HeroSpeak spoken={spoken} label={label} />;
  const side = size === 'large' ? 52 : MIN_TAP;
  return (
    <Tappable
      onPress={() => (spoken.listening ? spoken.stop() : void spoken.start())}
      accessibilityRole="button"
      accessibilityLabel={spoken.listening ? 'Stop listening' : label}
      accessibilityState={{ busy: spoken.listening }}
      scaleTo={0.95}
      style={{
        width: side, height: side, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: spoken.listening ? c.dangerFill : c.fill,
      }}
    >
      <Icon name={spoken.listening ? 'stop.fill' : 'mic.fill'} size={size === 'large' ? 20 : 17} color={spoken.listening ? c.danger : c.text} />
    </Tappable>
  );
}

/** The microphone as the main control on a card: a large gold circle with two faint rings around it, red while it listens. */
function HeroSpeak({ spoken, label }: { spoken: Spoken; label: string }) {
  const c = useTheme();
  const ring = spoken.listening ? c.danger : c.accent;
  return (
    <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -9, right: -9, bottom: -9, left: -9, borderRadius: 60, borderWidth: 1, borderColor: ring, opacity: 0.35 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -18, right: -18, bottom: -18, left: -18, borderRadius: 70, borderWidth: 1, borderColor: ring, opacity: 0.15 }} />
      <Tappable
        onPress={() => (spoken.listening ? spoken.stop() : void spoken.start())}
        accessibilityRole="button"
        accessibilityLabel={spoken.listening ? 'Stop listening' : label}
        accessibilityState={{ busy: spoken.listening }}
        scaleTo={0.95}
        style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: spoken.listening ? c.danger : c.accent }}
      >
        <Icon name={spoken.listening ? 'stop.fill' : 'mic.fill'} size={34} color={spoken.listening ? c.onRating : c.onAccent} />
      </Tappable>
    </View>
  );
}

/** While listening: a line saying so, in the language, and that it stops on a pause. Then any problem. */
export function ListeningNote({ spoken, language }: { spoken: Spoken; language: string }) {
  const c = useTheme();
  if (spoken.listening) {
    return (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Icon name="waveform" size={16} color={c.danger} />
        <Text style={{ ...type.footnote, color: c.textSecondary, flex: 1 }}>{`Listening for ${language}. Stops by itself when you pause.`}</Text>
      </View>
    );
  }
  return spoken.problem ? <Text style={{ ...type.footnote, color: c.danger }}>{spoken.problem}</Text> : null;
}

/**
 * Situations' hold to talk: press and hold, speak, let go to send what was heard. While held, the
 * button says so; `onRelease` gets the press's end, after which the final text arrives through the
 * hook's `onHeard`.
 */
export function HoldToTalk({ spoken, disabled, onRelease }: { spoken: Spoken; disabled: boolean; onRelease: () => void }) {
  const c = useTheme();
  if (!spoken.available) return null;
  return (
    <Tappable
      onPressIn={() => { if (!disabled) void spoken.start(); }}
      onPressOut={() => { haptic.tap(); spoken.stop(); onRelease(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={spoken.listening ? 'Let go to send' : 'Hold to talk'}
      accessibilityHint="Hold, speak, and let go to send what was heard"
      restOpacity={disabled ? 0.45 : 1}
      scaleTo={0.98}
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s, minHeight: 56, borderRadius: radius.pill,
        paddingHorizontal: space.l, backgroundColor: spoken.listening ? c.danger : c.accent,
      }}
    >
      <Icon name="mic.fill" size={20} color={spoken.listening ? c.onRating : c.onAccent} />
      <Text style={{ ...type.headline, color: spoken.listening ? c.onRating : c.onAccent }}>{spoken.listening ? 'Let go to send' : 'Hold to talk'}</Text>
    </Tappable>
  );
}
