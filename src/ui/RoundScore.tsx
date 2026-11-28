import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { space, type, useTheme } from './theme';

/**
 * How a finished round went, the same wherever a round ends (a drill, a quiz, Read & Listen's line
 * drill and text check, a Practice tool): a ring filled in the accent for the share right, the
 * number in the middle, and `what` under it ("right the first time"), which also finishes the
 * spoken label. `heading` is a small line over it (the round's name, or "End of the round").
 */
export function RoundScore({ right, asked, what, heading }: { right: number; asked: number; what: string; heading?: string }) {
  const c = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.s }}>
      {heading ? <Text numberOfLines={2} style={{ ...type.overline, color: c.textSecondary, textAlign: 'center' }}>{heading}</Text> : null}
      <RoundRing right={right} asked={asked} what={what} />
      <Text style={{ ...type.body, color: c.text, textAlign: 'center' }}>{what}</Text>
    </View>
  );
}

function RoundRing({ right, asked, what }: { right: number; asked: number; what: string }) {
  const c = useTheme();
  const size = 150;
  const r = 64;
  const circumference = 2 * Math.PI * r;
  const share = asked ? right / asked : 0;
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={`${right} of ${asked} ${what}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 150 150" style={{ position: 'absolute' }}>
        <Circle cx={75} cy={75} r={r} stroke={c.fill} strokeWidth={10} fill="none" />
        <Circle cx={75} cy={75} r={r} stroke={c.accent} strokeWidth={10} strokeLinecap="round" fill="none" strokeDasharray={`${circumference * share} ${circumference}`} transform="rotate(-90 75 75)" />
      </Svg>
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.largeTitle, fontSize: 52, lineHeight: 58, color: c.text, fontVariant: ['tabular-nums'] }}>{right}</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.subhead, color: c.textSecondary }}>{`of ${asked}`}</Text>
    </View>
  );
}
