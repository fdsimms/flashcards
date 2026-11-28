import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useReduceMotion } from './motion';
import { radius, space, type, useTheme } from './theme';

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
      <View style={{ width: 10, height: 10, borderRadius: radius.pill, backgroundColor: tint }} />
      <Animated.View
        style={{
          position: 'absolute', width: MARK, height: MARK, borderRadius: radius.pill, borderWidth: 2,
          borderColor: 'transparent', borderTopColor: tint, borderRightColor: tint,
          transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
        }}
      />
    </View>
  );
}

/**
 * A wait in words: the turning mark and what's under way ("Thinking of themes"), read by VoiceOver
 * as one item. The same everywhere a screen waits on Claude or a server without steps to show.
 */
export function WorkingLine({ text }: { text: string }) {
  const c = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={text} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
      <WorkingMark />
      <Text style={{ ...type.subhead, color: c.textSecondary, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}
