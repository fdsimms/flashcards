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

/** Springs in from slightly smaller, once `ready`: for a popover that's drawn where the finger was. */
export function Pop({ ready = true, children, style }: { ready?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready) return;
    if (reduce) { v.setValue(1); return; }
    Animated.spring(v, { toValue: 1, speed: 22, bounciness: 4, useNativeDriver: true }).start();
  }, [ready, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Fades in when it first appears, in place (no rise). For a highlight that comes and goes. */
export function FadeIn({ children, style, duration = 140, delay = 0 }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; duration?: number; delay?: number }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 0 : duration, delay: reduce ? 0 : delay, useNativeDriver: true }).start();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View pointerEvents="none" style={[style, { opacity: v }]}>{children}</Animated.View>;
}

/** A bar or block that grows from its baseline (scaleY) when it first appears; `delay` staggers a row of them. */
export function Grow({ children, style, delay = 0 }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; delay?: number }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(v, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Anchored at the bottom: scaling is about the center, so shift by half the height lost.
  const [h, setH] = useState(0);
  return (
    <Animated.View
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
      style={[style, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [h / 2, 0] }) }, { scaleY: v }] }]}
    >
      {children}
    </Animated.View>
  );
}
