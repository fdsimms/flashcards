import React from 'react';
import { Text, View } from 'react-native';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { lift, MIN_TAP, radius, smooth, space, type, useTheme } from '../theme';

/**
 * A pill over the bottom of the text, shown while the line being played is scrolled out of view:
 * its arrow points the way to it, and a tap scrolls it back. The reader keeps it away while the
 * line is on screen.
 */
export function ReaderJumpToLine({ line, side, onPress }: { line: number; side: 'above' | 'below'; onPress: () => void }) {
  const c = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: space.m, alignItems: 'center' }}>
      <Tappable
        onPress={() => { haptic.tap(); onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={`Scroll to line ${line}`}
        scaleTo={0.95}
        style={{
          minHeight: MIN_TAP, paddingHorizontal: space.l, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: space.s,
          backgroundColor: c.accent, ...smooth, ...lift(c, 'high'),
        }}
      >
        <Icon name={side === 'above' ? 'arrow.up' : 'arrow.down'} size={14} color={c.onAccent} weight="semibold" />
        <Text style={{ ...type.subhead, fontWeight: '600', color: c.onAccent }}>{`Line ${line}`}</Text>
      </Tappable>
    </View>
  );
}
