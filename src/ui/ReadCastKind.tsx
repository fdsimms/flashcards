import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { failureText } from '../core/failure';
import type { Api, CastKind, CastVoice, Language, Settings } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { audioKey, castInfo, clampPitch, pitchLabel, PITCH_MAX, PITCH_MIN, PITCH_STEP, voicesForKind } from '../reader/storyCast';
import { AzureVoiceRows, useAzureVoices } from './AzureVoices';
import { haptic } from './haptics';
import { Button, ErrorNote, Group, Help, Icon, NavRow, Screen, SectionTitle, Tappable } from './kit';
import { hairline, MIN_TAP, radius, readable, smooth, space, type, useTheme } from './theme';
import { useCastAudio } from './useCastAudio';

// How long after the last tap on the pitch buttons the choice is saved and played.
const SETTLE_MS = 500;

/**
 * One kind of story character (a girl): the voice and the pitch a story gives the first of them.
 * Choosing a voice, or changing the pitch, saves it and plays a line in it.
 */
export function ReadCastKind({ api, language, kind, current, onSettings, onAudition }: {
  api: Api;
  language: Language;
  kind: CastKind;
  /** The voice and pitch the kind has now. */
  current: CastVoice;
  /** The settings as the server has them after a change, for the rest of the app. */
  onSettings: (settings: Settings) => void;
  /** Opens the audition: the language's voices played side by side. */
  onAudition: () => void;
}) {
  const c = useTheme();
  const { label, gender } = castInfo(kind);
  const azure = useAzureVoices(api, language);
  const audio = useCastAudio(api);
  const [voice, setVoice] = useState(current.voice);
  const [pitch, setPitch] = useState(current.pitch);
  const [error, setError] = useState<string>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A pitch chosen and not yet saved: saved once the taps settle, or on leaving the screen.
  const pending = useRef<CastVoice | null>(null);

  const hear = (v: CastVoice) => audio.play(
    audioKey('sample', language, v.voice, v.pitch, language === 'th' ? gender : ''),
    () => api.castSample(language, v.voice, v.pitch, gender),
  );
  // The last choice sent to the server, which a failed save goes back to.
  const lastSaved = useRef(current);
  const save = async (v: CastVoice, before: CastVoice) => {
    pending.current = null;
    setError(undefined);
    try {
      onSettings(await api.updateSettings({ cast: { [language]: { [kind]: v } } }));
    } catch (e) {
      lastSaved.current = before;
      setVoice(before.voice);
      setPitch(before.pitch);
      setError(failureText(e, { what: "Couldn't save the voice.", next: 'Try again.' }));
    }
  };
  const commit = (v: CastVoice) => {
    const before = lastSaved.current;
    lastSaved.current = v;
    hear(v);
    save(v, before);
  };

  const choose = (v: string) => {
    clearTimeout(timer.current);
    setVoice(v);
    commit({ voice: v, pitch });
  };
  const nudge = (by: number) => {
    const next = clampPitch(pitch + by);
    if (next === pitch) return;
    haptic.select();
    setPitch(next);
    const v = { voice, pitch: next };
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(v), SETTLE_MS);
  };
  // Leaving before the wait is over still saves the pitch last chosen (without playing it).
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (pending.current) {
      api.updateSettings({ cast: { [language]: { [kind]: pending.current } } }).then(onSettings, () => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once, on leaving

  const options = azure.voices ? voicesForKind(azure.voices, kind) : undefined;
  const span = PITCH_MAX - PITCH_MIN;
  const at = (pitch - PITCH_MIN) / span;
  const zero = (0 - PITCH_MIN) / span;

  return (
    <Screen title={label}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.m }}>
        {error ? <ErrorNote message={error} /> : null}
        {azure.error ? <ErrorNote message={azure.error} onRetry={azure.retry} /> : null}
        {audio.error ? <ErrorNote message={audio.error} /> : null}
        <SectionTitle>Voice</SectionTitle>
        {!options && !azure.error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {options ? (
          <Group accessibilityRole="radiogroup">
            <AzureVoiceRows voices={options} selected={voice} onChoose={(v) => { if (v) choose(v.voice); }} />
          </Group>
        ) : null}
        {options && options.length === 0 ? <Help>{`Azure lists no ${gender === 'male' ? "men's" : "women's"} voices in ${LANGUAGES[language].name}.`}</Help> : null}
        <Group>
          <NavRow first label="Audition voices" detail="Play one line in each voice to compare them" onPress={onAudition} />
        </Group>
        <SectionTitle>Pitch</SectionTitle>
        <Group>
          <View style={{ padding: space.l, gap: space.m }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <PitchButton icon="minus" label="Lower the pitch" disabled={pitch <= PITCH_MIN} onPress={() => nudge(-PITCH_STEP)} />
              <Text accessibilityLiveRegion="polite" style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{pitchLabel(pitch)}</Text>
              <PitchButton icon="plus" label="Raise the pitch" disabled={pitch >= PITCH_MAX} onPress={() => nudge(PITCH_STEP)} />
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ height: 6, borderRadius: 3, backgroundColor: c.fill, marginHorizontal: space.xs, marginTop: space.s }}>
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${Math.min(at, zero) * 100}%`, width: `${Math.abs(at - zero) * 100}%`, backgroundColor: c.accent, borderRadius: 3 }} />
              <View style={{ position: 'absolute', top: -8, left: `${at * 100}%`, marginLeft: -11, width: 22, height: 22, borderRadius: 11, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.controlEdge }} />
            </View>
          </View>
        </Group>
        <Button label="Hear a sample" onPress={() => {
          clearTimeout(timer.current);
          // A pitch still waiting to settle is saved with the sample rather than only played.
          if (pending.current) commit({ voice, pitch }); else hear({ voice, pitch });
        }} busy={audio.busy} />
        <Help>
          {`Choosing a voice or changing the pitch plays a line. A higher pitch suits a child and a lower one an older person; an adult is usually at 0 (a man is a little higher, as the narrator has the man's voice). Only ${gender === 'male' ? "men's" : "women's"} voices are listed.`}
        </Help>
      </ScrollView>
    </Screen>
  );
}

export function PitchButton({ icon, label, disabled, onPress }: { icon: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.92}
      restOpacity={disabled ? 0.4 : 1}
      style={{ width: MIN_TAP + space.s, height: MIN_TAP + space.s, borderRadius: radius.m, ...smooth, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={20} color={c.text} weight="semibold" />
    </Tappable>
  );
}
