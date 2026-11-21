import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { PICTURE_BOX, type Picture } from '../core/noteIcon';
import { useTheme } from './theme';

/**
 * A note's picture on a card (core/noteIcon.ts): its emoji, or its line drawing in the text color,
 * centered. `label` is what VoiceOver says for it, since a picture has no words of its own.
 */
export function NoteIcon({ picture, size = 64, label }: { picture: Picture; size?: number; label: string }) {
  const c = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ alignItems: 'center' }}>
      {'emoji' in picture ? (
        <Text allowFontScaling={false} style={{ fontSize: size * 0.85, lineHeight: size }}>{picture.emoji}</Text>
      ) : (
        <Svg width={size} height={size} viewBox={`0 0 ${PICTURE_BOX} ${PICTURE_BOX}`}>
          {picture.paths.map((d, i) => <Path key={i} d={d} stroke={c.text} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        </Svg>
      )}
    </View>
  );
}
