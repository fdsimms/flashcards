import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useReduceMotion } from './motion';
import { useTheme } from './theme';

export const MARK = 18;

/** The gold dot with an arc turning around it: what is under way. The same mark marks the current step of a making card. (Drawn from Views, not an icon, so `kit.tsx`'s Button can use it.) */
export function WorkingMark({ color }: { color?: string }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const turn = useRef(new Animated.Value(0)).current;
  const tint = color ?? c.accent;
  useEffect(() => {
    if (reduce) return undefined;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: MARK, height: MARK, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tint }} />
      <Animated.View
        style={{
          position: 'absolute', width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: 2,
          borderColor: 'transparent', borderTopColor: tint, borderRightColor: tint,
          transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
        }}
      />
    </View>
  );
}
