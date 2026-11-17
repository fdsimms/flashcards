import React from 'react';
import { Text, View } from 'react-native';
import { radius, space, type, useTheme } from './theme';

/**
 * A reminder on the answer side that this review card is shaky: its chance of being recalled now,
 * by FSRS, as a thin bar. Only for a fragile card (`fragilePercent`); it's never an input to the rating.
 */
export function MemoryStrength({ percent }: { percent: number }) {
  const c = useTheme();
  return (
    <View accessible accessibilityLabel={`About ${percent} percent likely to be remembered now`} style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>Chance of remembering now</Text>
        <Text style={{ ...type.footnote, fontWeight: '600', color: c.warning }}>{`${percent}%`}</Text>
      </View>
      <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', borderRadius: radius.pill, backgroundColor: c.warning }} />
      </View>
    </View>
  );
}
