import React from 'react';
import { Text } from 'react-native';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

/**
 * A listening card's "Can't listen now": starts Quiet mode (src/core/quietMode.ts) for the default
 * length, and a long press offers the other lengths. Sits where the card's other ways to answer are.
 */
export function QuietChip({ onStart, onChoose }: { onStart: () => void; onChoose: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.select(); onStart(); }}
      onLongPress={() => { haptic.select(); onChoose(); }}
      accessibilityRole="button"
      accessibilityLabel="Can't listen now"
      accessibilityHint="Sets listening cards aside and turns off sound for a while. Touch and hold to choose how long."
      scaleTo={0.94}
      style={{ alignSelf: 'center', minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, borderRadius: radius.pill, borderWidth: 1, borderColor: c.controlEdge }}
    >
      <Icon name="speaker.slash" size={16} color={c.text} weight="semibold" />
      <Text style={{ ...type.callout, fontWeight: '600', color: c.text }}>Can't listen now</Text>
    </Tappable>
  );
}
