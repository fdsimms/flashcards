import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Card } from './kit';
import { useReduceMotion } from './motion';
import { radius, space, useTheme, smooth } from './theme';

/**
 * Wraps placeholders so they pulse gently while content loads (still, with Reduce Motion), and
 * hides them from VoiceOver as decoration: the screen says it's loading some other way.
 */
export function Pulse({ children }: { children: React.ReactNode }) {
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ gap: space.m, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}
    >
      {children}
    </Animated.View>
  );
}

/** One placeholder block: a line of text, a count, a chip. Width is a percentage or points. */
export function SkeletonBar({ width, height, radiusSize = radius.s }: { width: `${number}%` | number; height: number; radiusSize?: number }) {
  const c = useTheme();
  return <View style={{ width, height, borderRadius: radiusSize, ...smooth, backgroundColor: c.fill }} />;
}

/** Placeholder rows for a list that's still loading, so the screen has its shape before the content arrives. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <Pulse>
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} style={{ gap: space.s }}>
          <SkeletonBar width="55%" height={18} />
          <SkeletonBar width="90%" height={12} />
          <SkeletonBar width="70%" height={12} />
        </Card>
      ))}
    </Pulse>
  );
}
