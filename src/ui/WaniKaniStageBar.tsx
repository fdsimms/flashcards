import React from 'react';
import { View } from 'react-native';
import { STAGE_GROUPS, type StageCounts } from '../wanikani/stats';
import { space, useTheme, type Colors } from './theme';

/** Each stage group's tint: the ones the stage popup uses (StagePopup.tsx), Burned in the quiet text color. */
export function stageColors(c: Colors): Record<keyof StageCounts, string> {
  return { apprentice: c.rose, guru: c.violet, master: c.indigo, enlightened: c.teal, burned: c.textSecondary };
}

/** Items by stage group as one thin bar, each group as wide as its count. The row says it aloud; the bar is only for the eye. */
export function StageBar({ stages }: { stages: StageCounts }) {
  const c = useTheme();
  const colors = stageColors(c);
  const shown = STAGE_GROUPS.filter((g) => stages[g.key] > 0);
  if (!shown.length) return null;
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', height: 8, gap: 2, marginTop: space.xs, borderRadius: 4, overflow: 'hidden' }}>
      {shown.map((g) => <View key={g.key} style={{ flex: stages[g.key], minWidth: 3, backgroundColor: colors[g.key] }} />)}
    </View>
  );
}
