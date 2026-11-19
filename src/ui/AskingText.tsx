import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useReduceMotion } from './motion';

const DOTS = 3;
const CYCLE = 1200;

/**
 * "Asking Claude…" with the three dots pulsing in turn, so a wait for an answer looks alive. One
 * place for every spot that says it (the ask sheet, hint suggestions, the flag sheet, the reader's
 * phrase popup). With Reduce Motion on, the dots stay still. The words are one accessibility
 * element, so VoiceOver reads "Asking Claude" once rather than a dot at a time.
 */
export function AskingText({ style, label = 'Asking Claude' }: { style?: StyleProp<TextStyle>; label?: string }) {
  const reduce = useReduceMotion();
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return undefined;
    phase.setValue(0);
    const loop = Animated.loop(Animated.timing(phase, { toValue: 1, duration: CYCLE, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text style={style}>{label}</Text>
      {Array.from({ length: DOTS }, (_, i) => {
        // Each dot peaks a third of a cycle after the one before it.
        const at = i / DOTS;
        const opacity = reduce
          ? 1
          : phase.interpolate({
              inputRange: [0, at, at + 0.15, at + 0.3, 1],
              outputRange: [0.3, 0.3, 1, 0.3, 0.3],
              extrapolate: 'clamp',
            });
        return <Animated.Text key={i} style={[style, { opacity }]}>.</Animated.Text>;
      })}
    </View>
  );
}
