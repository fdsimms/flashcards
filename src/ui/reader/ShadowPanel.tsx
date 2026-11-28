import React from 'react';
import { Text, View } from 'react-native';
import { Button, Help } from '../kit';
import { PitchLine } from '../PitchLine';
import { RecordYourself } from '../RecordYourself';
import { radius, space, type, useTheme } from '../theme';
import type { Shadowing } from './useShadowing';

/**
 * Shadow's turn in Watch (useShadowing): which line it's on, Record yourself, and once there's a take,
 * a podcast's pitch line over the speaker's (PitchLine, from the line's clip), or for a video, Both to
 * hear the line then the take. Line again replays the line; Next line goes on.
 */
export function ShadowPanel({ shadow, count, video }: { shadow: Shadowing; count: number; video: boolean }) {
  const c = useTheme();
  if (!shadow.on || shadow.line < 0) return null;
  const { rec, phase, clipUri } = shadow;
  const last = shadow.line + 1 >= count;
  const status = phase === 'playing' ? 'Listen to the line.' : phase === 'both' ? 'The line, then yours.' : rec.recording ? 'Say the line, then tap Stop.' : rec.hasTake ? 'Compare, or try again.' : 'Your turn: tap Record and say the line.';
  return (
    <View style={{ marginHorizontal: space.l, marginBottom: space.s, padding: space.m, gap: space.s, borderRadius: radius.l, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.s }}>
        <Text accessibilityRole="header" style={{ ...type.overline, color: c.textTertiary }}>{`Line ${shadow.line + 1} of ${count}`}</Text>
        <Text style={{ ...type.footnote, color: c.textSecondary, flexShrink: 1, textAlign: 'right' }}>{status}</Text>
      </View>
      <View style={{ alignItems: 'center' }}>
        <RecordYourself rec={rec} label="Record" size="card" />
      </View>
      {rec.takeUri && !rec.recording && clipUri ? <PitchLine takeUri={rec.takeUri} recordingUri={clipUri} /> : null}
      {shadow.clipError && rec.hasTake ? <Help>{shadow.clipError}</Help> : null}
      {video && rec.hasTake ? <Help>No pitch line for videos: YouTube's player doesn't let Franki read its sound.</Help> : null}
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <View style={{ flex: 1 }}><Button label="Line again" variant="secondary" onPress={() => shadow.playLine(shadow.line)} disabled={rec.recording} /></View>
        {video && rec.hasTake ? <View style={{ flex: 1 }}><Button label="Both" variant="secondary" onPress={shadow.both} disabled={rec.recording} /></View> : null}
        <View style={{ flex: 1 }}><Button label="Next line" onPress={shadow.next} disabled={last || rec.recording} /></View>
      </View>
    </View>
  );
}
