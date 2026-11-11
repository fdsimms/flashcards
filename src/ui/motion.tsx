import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Motion, kept short and kept off for anyone who asked the system for less of it (Settings,
 * Accessibility, Motion, Reduce Motion): every animation here collapses to an instant change.
 */

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (alive) setReduce(on); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}

/** Fades its content in, rising a few points, when it first appears. Key it to replay. */
export function Reveal({ children, style, rise = 8, delay = 0 }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  rise?: number;
  delay?: number;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 0 : 240, delay: reduce ? 0 : delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/**
 * A screen arriving: sliding in from the right when it's deeper in the app than the last one
 * (`direction` 1), from the left when going back (-1), only fading when it's neither. Key it to
 * the screen so each one plays its own.
 */
export function ScreenTransition({ children, direction }: { children: React.ReactNode; direction: -1 | 0 | 1 }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 0 : 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Read once, on arrival: a re-render partway through must not change where it's sliding from.
  const [from] = useState(() => (direction === 1 ? 44 : direction === -1 ? -28 : 0));
  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
