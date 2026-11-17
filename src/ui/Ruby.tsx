import React from 'react';
import { Text, View, type TextStyle } from 'react-native';
import type { Run } from '../core/furigana';

/**
 * Japanese with furigana (src/core/furigana.ts): each run of kanji with its reading set above it, at
 * half the text's size. React Native has no ruby, so each run is a column of its reading and its
 * text, and the runs wrap as a row; every one keeps the reading's height, so the line's text stays
 * on one baseline whether a run has a reading or not. Text without a reading is split character by
 * character, since Japanese breaks a line anywhere. VoiceOver reads the text once, in Japanese.
 */
export function Ruby({ runs, style, rubyColor, center }: {
  runs: Run[];
  /** The text's own style: size, line height, color, face and weight. */
  style: TextStyle;
  rubyColor: string;
  center?: boolean;
}) {
  const size = style.fontSize ?? 17;
  const rubyStyle: TextStyle = { fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.65), color: rubyColor, fontFamily: style.fontFamily, textAlign: 'center' };
  const pieces = runs.flatMap((r): Run[] => (r.ruby ? [r] : Array.from(r.text, (text) => ({ text }))));
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={runs.map((r) => r.text).join('')}
      accessibilityLanguage="ja-JP"
      style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: center ? 'center' : 'flex-start' }}
    >
      {pieces.map((p, i) => (
        <View key={i} style={{ alignItems: 'center' }}>
          <Text style={rubyStyle} allowFontScaling>{p.ruby ?? ' '}</Text>
          <Text style={style}>{p.text}</Text>
        </View>
      ))}
    </View>
  );
}
