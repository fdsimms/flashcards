import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Card } from './kit';
import { useReduceMotion } from './motion';
import { radius, space, useTheme, smooth } from './theme';

/**
 * Placeholder rows for a list that's still loading, pulsing gently, so the screen has its shape
 * before the content arrives. Still (no pulse) with Reduce Motion. Hidden from VoiceOver as
 * decoration; the screen it's on says it's loading some other way.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  const c = useTheme();
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
  const bar = (width: `${number}%`, height: number) => <View style={{ width, height, borderRadius: radius.s, ...smooth, backgroundColor: c.fill }} />;
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ gap: space.m, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} style={{ gap: space.s }}>
          {bar('55%', 18)}
          {bar('90%', 12)}
          {bar('70%', 12)}
        </Card>
      ))}
    </Animated.View>
  );
}
