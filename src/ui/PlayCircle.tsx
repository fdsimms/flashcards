import React from 'react';
import { View } from 'react-native';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, useTheme } from './theme';

/** The two sizes: `bar` in the reader's player bar along the foot of a text, `large` anywhere it's the screen's one big control (a lesson, Now Playing, a line or a Practice question to listen to). */
const SIZES = { bar: { box: 52, icon: 22 }, large: { box: 68, icon: 30 } } as const;

/**
 * The round gold Play button, a pause icon while `playing`: Read & Listen's players and the
 * listening questions in Read & Listen and Practice. One component so the screens that have one
 * draw it at the same size and weight. It gives no haptic of its own: the
 * caller's `onPress` does (`useSoundingButton`'s `tap` already does).
 */
export function PlayCircle({ playing, onPress, accessibilityLabel, size = 'large' }: {
  playing: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  size?: keyof typeof SIZES;
}) {
  const c = useTheme();
  const s = SIZES[size];
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.92}
      style={{ width: s.box, height: s.box, borderRadius: radius.pill, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={playing ? 'pause.fill' : 'play.fill'} size={s.icon} color={c.onAccent} weight="semibold" />
    </Tappable>
  );
}

/**
 * The small round play button beside a word or a line: 44pt, gold-tinted, a pause icon while
 * `playing`. The same size and symbol wherever one sits (a word in the reader, a line drill, a
 * corrected text, a journal entry, a Situation's turn, a native recording, a text check's line).
 * Like PlayCircle it gives no haptic of its own. Without `onPress` it is only the mark, for a row
 * that plays when any of it is tapped (the sound guide).
 */
export function PlayDot({ label, onPress, playing = false, speaker }: { label?: string; onPress?: () => void; playing?: boolean; /** A speaker rather than a play triangle, for a line read aloud. */ speaker?: boolean }) {
  const c = useTheme();
  const look = { width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' } as const;
  const mark = <Icon name={playing ? 'pause.fill' : speaker ? 'speaker.wave.2.fill' : 'play.fill'} size={16} color={c.accent} weight="semibold" />;
  if (!onPress) return <View style={look}>{mark}</View>;
  return (
    <Tappable onPress={onPress} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : label} scaleTo={0.92} style={look}>
      {mark}
    </Tappable>
  );
}
