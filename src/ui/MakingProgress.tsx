import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { StageStep } from '../reader/making';
import { useReduceMotion } from './motion';
import { radius, space, type, useTheme } from './theme';

/**
 * What a `NavRow` shows under its name while its thing is being made: the step under way with "1 of
 * 3", and a bar of one segment per step that fills as the steps finish, with a light sweeping
 * across the current one. The line slides in when the step changes. Lives in its own file so
 * `kit.tsx` can use it without importing `MakingCard` (which imports the kit).
 */
export function MakingProgress({ steps }: { steps: StageStep[] }) {
  const c = useTheme();
  const at = Math.max(0, steps.findIndex((s) => s.status === 'now'));
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.s }}>
        <StepText label={steps[at].label} />
        <Text style={{ ...type.footnote, color: c.textTertiary, fontVariant: ['tabular-nums'] }}>{`${at + 1} of ${steps.length}`}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {steps.map((s) => <Segment key={s.label} status={s.status} />)}
      </View>
    </View>
  );
}

/** The step's name, in the text color; it slides in from the left whenever the name changes. */
function StepText({ label }: { label: string }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reduce) return;
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [label, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.Text
      style={{
        ...type.footnote,
        color: c.text,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
      }}
    >
      {label}
    </Animated.Text>
  );
}

/** One step's piece of the bar: filled when done, a sweeping light when current, empty when to come. */
function Segment({ status }: { status: StageStep['status'] }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const now = status === 'now';
  useEffect(() => {
    if (!now || reduce) return undefined;
    sweep.setValue(0);
    const loop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [now, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flex: 1, height: 3, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: status === 'done' ? c.accent : c.fill }}
    >
      {now ? (
        // Reduce Motion: a half-filled segment says "under way" without moving.
        <Animated.View
          style={{
            width: reduce ? '50%' : Math.max(width * 0.45, 1), height: 3, backgroundColor: c.accent,
            transform: reduce ? [] : [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.45, width] }) }],
          }}
        />
      ) : null}
    </View>
  );
}
