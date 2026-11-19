import React from 'react';
import { Text, View } from 'react-native';
import { BAR_COUNT, type WordFrequency } from '../../reader/frequency';
import { type, useTheme } from '../theme';

/**
 * A word's commonality at the end of a suggested-word row: four rising bars, filled up to its band,
 * and the band under them. The row's own label says it aloud (`WordFrequency.spoken`), so this is hidden from VoiceOver.
 */
export function FrequencyMeter({ frequency }: { frequency: WordFrequency }) {
  const c = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexShrink: 0, alignItems: 'flex-end', gap: 3 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 }}>
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <View
            key={i}
            style={{ width: 5, height: 5 + i * 3, borderRadius: 1.5, backgroundColor: i < frequency.bars ? c.accent : c.border }}
          />
        ))}
      </View>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{frequency.band}</Text>
    </View>
  );
}
