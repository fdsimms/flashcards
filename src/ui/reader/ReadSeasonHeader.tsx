import React from 'react';
import { Text, View } from 'react-native';
import { haptic } from '../haptics';
import { Icon, Tappable } from '../kit';
import { space, type, useTheme } from '../theme';

/** A season's title on a story's page, with what's read in it; tapping it folds or opens the season. */
export function ReadSeasonHeader({ title, summary, open, onToggle }: { title: string; summary: string; open: boolean; onToggle: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onToggle(); }}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}. ${summary}`}
      accessibilityHint={open ? 'Hides its episodes' : 'Shows its episodes'}
      scaleTo={1}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.xs }}
    >
      <Text style={{ ...type.overline, color: c.textSecondary, flex: 1 }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <Text style={{ ...type.footnote, color: c.textSecondary }}>{summary}</Text>
        <Icon name={open ? 'chevron.down' : 'chevron.right'} size={13} color={c.textTertiary} weight="semibold" />
      </View>
    </Tappable>
  );
}
