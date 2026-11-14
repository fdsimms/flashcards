import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

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

/**
 * A number that counts to its new value when it changes (the deck list's counts after a session),
 * and shows the first value as it is. The text is redrawn each frame, so it's JS-driven; only
 * counts that changed run.
 */
export function CountingText({ value, style }: { value: number; style?: StyleProp<TextStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(value)).current;
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const id = v.addListener(({ value: n }) => setShown(Math.round(n)));
    return () => v.removeListener(id);
  }, [v]);
  useEffect(() => {
    if (reduce) { v.setValue(value); return undefined; }
    const run = Animated.timing(v, { toValue: value, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [value, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Text style={style}>{shown}</Text>;
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
