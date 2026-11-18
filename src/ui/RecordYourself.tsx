import React from 'react';
import { Text, View } from 'react-native';
import { takeClock } from '../core/selfRecording';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, space, type, useTheme } from './theme';
import type { SelfRecording } from './useSelfRecording';

/**
 * The idle Record button as a round, icon-only button the size of the reader player's Repeat
 * button, for sitting beside it. Once a take is made or being made, RecordYourself's capsule
 * takes over on a row of its own, so the reader shows this only while `idleRecording(rec)`.
 */
export function RecordIconButton({ rec, label }: { rec: SelfRecording; label: string }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={rec.start}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Records your voice to play back next to the recording.`}
      scaleTo={0.92}
      style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}
    >
      <Icon name="mic.fill" size={18} color={c.textSecondary} weight="semibold" />
    </Tappable>
  );
}

/** Whether Record yourself is in its starting state: no take made and none being made. */
export function idleRecording(rec: SelfRecording): boolean {
  return !rec.recording && !rec.hasTake;
}

/**
 * Record yourself's buttons (useSelfRecording): a Record chip, then Stop with the time while a
 * take is made, then one capsule: Yours to play the take, Compare to play the card's or line's
 * recording and then the take (when there is a recording), and a mic to make a new one. `size` matches the
 * chips beside them: the review card's Play, or the reader player's Repeat line.
 */
export function RecordYourself({ rec, label, size }: {
  rec: SelfRecording;
  /** The Record chip's label: "Record", "Record line 2". */
  label: string;
  size: 'card' | 'player';
}) {
  const c = useTheme();
  const card = size === 'card';
  const text = card ? { ...type.callout, fontWeight: '600' as const } : { ...type.footnote, fontWeight: '600' as const };
  const iconSize = card ? 18 : 14;
  const chip = {
    minHeight: MIN_TAP, flexDirection: 'row' as const, alignItems: 'center' as const, gap: card ? space.s : space.xs,
    paddingHorizontal: card ? space.l : space.m, borderRadius: radius.pill,
  };

  if (rec.recording) {
    return (
      <Tappable onPress={() => rec.stop()} accessibilityRole="button" accessibilityLabel="Stop recording" scaleTo={0.94} style={{ ...chip, backgroundColor: c.dangerFill }}>
        <Icon name="stop.fill" size={iconSize} color={c.danger} weight="semibold" />
        <Text style={{ ...text, color: c.danger, fontVariant: ['tabular-nums'] }}>Stop · {takeClock(rec.millis)}</Text>
      </Tappable>
    );
  }
  if (rec.hasTake) {
    const alone = rec.playing === 'take';
    const comparing = rec.playing === 'compare-original' || rec.playing === 'compare-take';
    // One capsule: the three act on the same take. The one playing is filled, and Compare names its step.
    const seg = (active: boolean) => ({
      minHeight: MIN_TAP, flexDirection: 'row' as const, alignItems: 'center' as const, gap: card ? space.s : space.xs,
      paddingHorizontal: card ? space.l : space.m, backgroundColor: active ? c.accentFill : undefined,
    });
    const divider = <View style={{ width: hairline, alignSelf: 'stretch', marginVertical: space.s, backgroundColor: c.border }} />;
    const compareText = rec.playing === 'compare-original' ? 'Recording' : rec.playing === 'compare-take' ? 'Yours' : 'Compare';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
        <Tappable onPress={rec.playTake} accessibilityRole="button" accessibilityLabel={alone ? 'Stop your recording' : 'Play your recording'} scaleTo={0.96} style={seg(alone)}>
          <Icon name={alone ? 'stop.fill' : 'play.fill'} size={iconSize} color={c.accentInk} weight="semibold" />
          <Text style={{ ...text, color: c.accentInk }}>Yours</Text>
        </Tappable>
        {rec.canCompare ? (
          <>
            {divider}
            <Tappable
              onPress={rec.compare}
              accessibilityRole="button"
              accessibilityLabel={comparing ? 'Stop comparing' : 'Compare'}
              accessibilityHint={comparing ? undefined : 'Plays the recording, then yours.'}
              scaleTo={0.96}
              style={seg(comparing)}
            >
              <Icon name={comparing ? 'stop.fill' : 'arrow.left.arrow.right'} size={iconSize} color={c.accentInk} weight="semibold" />
              {card || comparing ? <Text style={{ ...text, color: c.accentInk }}>{compareText}</Text> : null}
            </Tappable>
          </>
        ) : null}
        {divider}
        <Tappable
          onPress={rec.start}
          accessibilityRole="button"
          accessibilityLabel="Record yourself again"
          scaleTo={0.92}
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', paddingHorizontal: card ? space.s : 0 }}
        >
          <Icon name="mic.fill" size={iconSize} color={c.textSecondary} weight="semibold" />
        </Tappable>
      </View>
    );
  }
  return (
    <Tappable onPress={rec.start} accessibilityRole="button" accessibilityLabel={`${label}. Records your voice to play back next to the recording.`} scaleTo={0.94} style={{ ...chip, backgroundColor: c.fill }}>
      <Icon name="mic.fill" size={iconSize} color={c.textSecondary} weight="semibold" />
      <Text style={{ ...text, color: c.textSecondary }}>{label}</Text>
    </Tappable>
  );
}
