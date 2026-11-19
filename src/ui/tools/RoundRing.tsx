import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { type, useTheme } from '../theme';

/** A score as a ring filled in the accent, the number right in the middle: the end of a Sentences round, and how a Situation went. `what` finishes the spoken label ("right the first time"). */
export function RoundRing({ right, asked, what = 'right the first time' }: { right: number; asked: number; what?: string }) {
  const c = useTheme();
  const size = 150;
  const r = 64;
  const circumference = 2 * Math.PI * r;
  const share = asked ? right / asked : 0;
  return (
    <View accessible accessibilityLabel={`${right} of ${asked} ${what}`} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 150 150" style={{ position: 'absolute' }}>
        <Circle cx={75} cy={75} r={r} stroke={c.fill} strokeWidth={10} fill="none" />
        <Circle cx={75} cy={75} r={r} stroke={c.accent} strokeWidth={10} strokeLinecap="round" fill="none" strokeDasharray={`${circumference * share} ${circumference}`} transform="rotate(-90 75 75)" />
      </Svg>
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.largeTitle, fontSize: 52, lineHeight: 58, color: c.text, fontVariant: ['tabular-nums'] }}>{right}</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ ...type.subhead, color: c.textSecondary }}>{`of ${asked}`}</Text>
    </View>
  );
}
