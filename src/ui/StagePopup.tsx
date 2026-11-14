import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { StageChange } from '../wanikani/srs';
import { Icon } from './kit';
import { useReduceMotion } from './motion';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

/** How long the pill stays up: Burned ends an item for good, so it stays a little longer. */
export function stagePopupMs(change: StageChange): number {
  return change.burned ? 2200 : 1400;
}

/**
 * The pill on the card's lower edge when an answer moves an item into another stage group
 * (Apprentice, Guru, Master, Enlightened, Burned). Each group takes a tint from the theme. A drop is
 * a neutral pill with a down arrow, so a miss shows without an alarm color. The parent removes it
 * after `stagePopupMs`; it only fades itself in. Key it to the answer so each one replays.
 */
export function StagePopup({ change }: { change: StageChange }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  const tint: Record<string, string> = { Apprentice: c.rose, Guru: c.violet, Master: c.indigo, Enlightened: c.teal, Burned: c.textSecondary };
  const fill = change.up ? tint[change.group] ?? c.accent : c.surface;
  // Burned's fill is the secondary text color, so its text is the page's background.
  const ink = !change.up ? c.text : change.burned ? c.bg : c.onRating;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -space.l - space.xs, alignItems: 'center' }}>
      <Animated.View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={`${change.up ? 'Moved up to' : 'Dropped back to'} ${change.group}`}
        style={{
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
          flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s,
          borderRadius: radius.pill, ...smooth, backgroundColor: fill,
          borderWidth: change.up ? 2 : hairline, borderColor: change.up ? c.stageRing : c.border,
        }}
      >
        <Icon name={change.up ? 'arrow.up' : 'arrow.down'} size={16} color={ink} weight="bold" />
        <Text style={{ ...type.headline, color: ink }}>{change.group}</Text>
      </Animated.View>
    </View>
  );
}
