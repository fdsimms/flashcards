import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, LayoutAnimation, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

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
 * Call with how many items a list shows. When the count drops, the next layout fades the
 * removed item out and slides what's below up into its place, instead of the list jumping. It
 * runs during render so it is queued before the commit that removes the item; a count that grows
 * is left to the item's own Reveal.
 */
export function useLeaveAnimation(count: number): void {
  const reduce = useReduceMotion();
  const last = useRef(count);
  if (count < last.current && !reduce) {
    LayoutAnimation.configureNext(LayoutAnimation.create(240, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  }
  last.current = count;
}

/**
 * A number that counts up to its value (the "reviews complete" summary only),
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
export function Reveal({ children, style, rise = 8, delay = 0, duration = 240 }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  rise?: number;
  delay?: number;
  /** How long the fade takes (ms). */
  duration?: number;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: reduce ? 0 : duration, delay: reduce ? 0 : delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/** Springs in from smaller (`from`, a share of full size), once `ready`: a popover drawn where the finger was, or a check mark landing. */
export function Pop({ ready = true, children, style, from = 0.92, bounciness = 4, delay = 0 }: {
  ready?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; from?: number; bounciness?: number; delay?: number;
}) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready) return;
    if (reduce) { v.setValue(1); return; }
    Animated.spring(v, { toValue: 1, speed: 22, bounciness, delay, useNativeDriver: true }).start();
  }, [ready, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }] }]}>
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

/**
 * Fades its content out and shrinks it to nothing after `delay`, so what's below moves up into the
 * space (a row that has served its purpose). The height is animated, not just the opacity, so the
 * box around it shrinks with it; that needs the JS driver. Draws nothing once finished. Give the
 * content its own bottom padding rather than a parent gap, so no space is left behind.
 */
export function Collapse({ children, delay = 0, duration = 220 }: { children: React.ReactNode; delay?: number; duration?: number }) {
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(1)).current;
  const [h, setH] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (reduce) { setGone(true); return undefined; }
    if (h === null) return undefined;
    const run = Animated.timing(v, { toValue: 0, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    run.start(({ finished }) => { if (finished) setGone(true); });
    return () => run.stop();
  }, [h === null, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  if (gone) return null;
  return (
    <Animated.View
      // The natural height is measured once, before anything shrinks.
      onLayout={h === null ? (e) => setH(e.nativeEvent.layout.height) : undefined}
      style={h === null ? undefined : { height: v.interpolate({ inputRange: [0, 1], outputRange: [0, h] }), opacity: v, overflow: 'hidden' }}
    >
      {children}
    </Animated.View>
  );
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
