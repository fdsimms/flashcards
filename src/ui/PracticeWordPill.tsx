import React from 'react';
import { Text } from 'react-native';
import { haptic } from './haptics';
import { Tappable } from './kit';
import { radius, space, type, useTheme } from './theme';

/**
 * A practice word as a pill: bold gold on a gold tint, the same in the reader and on the shelf's
 * story card. With `onPress` it opens the word's meaning (given where it was tapped, to place the
 * popover); without, a server that sent no practice words, it's only shown.
 */
export function PracticeWordPill({ word, onPress }: { word: string; onPress?: (x: number, y: number) => void }) {
  const c = useTheme();
  const pill = <TintPill text={word} bg={c.accentFill} fg={c.accent} />;
  if (!onPress) return pill;
  return (
    <Tappable
      onPress={(e) => { haptic.tap(); onPress(e.nativeEvent.pageX, e.nativeEvent.pageY); }}
      accessibilityRole="button"
      accessibilityLabel={`Meaning of ${word}`}
      // The pill is shorter than a full tap target; this makes up the rest.
      hitSlop={{ top: space.m, bottom: space.m }}
    >
      {pill}
    </Tappable>
  );
}

/** The pill's shape in any pair of colors: the reader's grammar points use it in speaker B's. */
export function TintPill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <Text style={{ ...type.subhead, fontWeight: '700', color: fg, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: space.xs, borderRadius: radius.pill, overflow: 'hidden' }}>
      {text}
    </Text>
  );
}
