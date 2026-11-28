import React from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { CountingText } from './motion';
import { type, useTheme } from './theme';

/**
 * A figure and what it counts ("1,284 / reviews this month"): Stats' and WaniKani's tiles, a
 * session's summary, Today's counts, a text's reading stats. A number ticks to each new value
 * (`CountingText`); text (a duration, a share) is shown as it is. `large` is Today's two headline
 * counts; `color` tints the figure (due, new); `centered` for figures in a row across a card.
 */
export function Figure({ value, label, color, large, centered, style }: {
  value: string | number;
  label: string;
  color?: string;
  large?: boolean;
  centered?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  const look = { ...(large ? type.largeTitle : type.title), color: color ?? c.text, fontVariant: ['tabular-nums'] } as const;
  return (
    <View style={[{ gap: 2, alignItems: centered ? 'center' : 'flex-start' }, style]}>
      {typeof value === 'number' ? <CountingText value={value} style={look} /> : <Text style={look}>{value}</Text>}
      <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: centered ? 'center' : 'left' }}>{label}</Text>
    </View>
  );
}
