import React from 'react';
import { Text } from 'react-native';
import { takeClock } from '../core/selfRecording';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';
import type { SelfRecording } from './useSelfRecording';

/**
 * Record yourself's buttons (useSelfRecording): a Record chip, then Stop with the time while a
 * take is made, then Yours to play the take and a round mic to make a new one. `size` matches the
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
    return (
      <>
        <Tappable onPress={rec.playTake} accessibilityRole="button" accessibilityLabel="Play your recording" scaleTo={0.94} style={{ ...chip, backgroundColor: c.fill }}>
          <Icon name="person.fill" size={iconSize} color={c.accent} weight="semibold" />
          <Text style={{ ...text, color: c.accent }}>Yours</Text>
        </Tappable>
        <Tappable
          onPress={rec.start}
          accessibilityRole="button"
          accessibilityLabel="Record yourself again"
          scaleTo={0.92}
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}
        >
          <Icon name="mic.fill" size={iconSize} color={c.textSecondary} weight="semibold" />
        </Tappable>
      </>
    );
  }
  return (
    <Tappable onPress={rec.start} accessibilityRole="button" accessibilityLabel={`${label}. Records your voice to play back next to the recording.`} scaleTo={0.94} style={{ ...chip, backgroundColor: c.fill }}>
      <Icon name="mic.fill" size={iconSize} color={c.textSecondary} weight="semibold" />
      <Text style={{ ...text, color: c.textSecondary }}>{label}</Text>
    </Tappable>
  );
}
