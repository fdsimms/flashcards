import React from 'react';
import { Icon, Tappable } from '../kit';
import { radius, useTheme } from '../theme';

/** The two sizes: `bar` in the reader's player bar along the foot of a text, `large` anywhere it's the screen's one big control (a lesson, Now Playing, a line to listen to). */
const SIZES = { bar: { box: 52, icon: 22 }, large: { box: 68, icon: 30 } } as const;

/**
 * Read & Listen's round gold Play button, a pause icon while `playing`. One component so the
 * screens that have one draw it at the same size and weight. It gives no haptic of its own: the
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
