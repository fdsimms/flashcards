import React from 'react';
import { Text, View } from 'react-native';
import { clockText, type ClockTime } from '../../tools/time';
import { useTheme } from '../theme';

/**
 * An analog clock showing `time`, drawn from Views: each tick and hand sits in a layer the size of
 * the face, rotated about its middle. A picture, so VoiceOver reads it as the time it shows, and
 * its numerals keep their size whatever the system text size.
 */
export function ClockFace({ time, size }: { time: ClockTime; size: number }) {
  const c = useTheme();
  const mid = size / 2;
  const layer = (deg: number, child: React.ReactNode, key?: number) => (
    <View key={key} pointerEvents="none" style={{ position: 'absolute', width: size, height: size, transform: [{ rotate: `${deg}deg` }] }}>{child}</View>
  );
  const hand = (deg: number, length: number, width: number, color: string) => layer(deg, (
    <View style={{ position: 'absolute', left: mid - width / 2, top: mid - length, width, height: length + width / 2, borderRadius: width / 2, backgroundColor: color }} />
  ));
  const hours = (time.hour % 12) + time.minute / 60;
  // The numerals' size follows the face's, so their box and its centering do too.
  const numeral = size * 0.085;
  const box = { width: Math.ceil(numeral * 2.2), height: Math.ceil(numeral * 1.4) };
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Clock showing ${clockText(time)}`}
      style={{ width: size, height: size, borderRadius: mid, backgroundColor: c.bg, borderWidth: 2, borderColor: c.border }}
    >
      {Array.from({ length: 60 }, (_, i) => layer(i * 6, (
        <View style={{ position: 'absolute', left: mid - (i % 5 ? 0.5 : 1.25), top: 3, width: i % 5 ? 1 : 2.5, height: i % 5 ? size * 0.035 : size * 0.06, backgroundColor: i % 5 ? c.textTertiary : c.text }} />
      ), i))}
      {Array.from({ length: 12 }, (_, i) => {
        const n = i + 1;
        const a = (n * 30 - 90) * (Math.PI / 180);
        const r = size * 0.33;
        return (
          <Text
            key={n}
            allowFontScaling={false}
            style={{ position: 'absolute', width: box.width, left: mid + r * Math.cos(a) - box.width / 2, top: mid + r * Math.sin(a) - box.height / 2, textAlign: 'center', fontSize: numeral, lineHeight: box.height, fontWeight: '600', color: c.text }}
          >
            {n}
          </Text>
        );
      })}
      {hand(hours * 30, size * 0.24, 5, c.text)}
      {hand(time.minute * 6, size * 0.37, 3, c.accent)}
      <View style={{ position: 'absolute', left: mid - 4, top: mid - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
    </View>
  );
}
