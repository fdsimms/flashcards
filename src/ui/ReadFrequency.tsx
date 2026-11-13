import React from 'react';
import { Text, View } from 'react-native';
import { BAR_COUNT, wordFrequency } from '../reader/frequency';
import type { Word } from '../reader/api';
import { radius, space, type, useTheme } from './theme';

/** How common the tapped word is, in the word popup: a meter, the band and its place in the list. */
export function ReadFrequency({ word }: { word: Pick<Word, 'status' | 'rank'> }) {
  const c = useTheme();
  const found = wordFrequency(word);
  if (!found) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }} accessible accessibilityLabel={found.spoken}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <View key={i} style={{ width: 16, height: 6, borderRadius: radius.pill, backgroundColor: i < found.bars ? c.accent : c.border }} />
        ))}
      </View>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{found.band} · {found.place}</Text>
    </View>
  );
}
