import React from 'react';
import { Text, View } from 'react-native';
import { selectedText } from '../core/selection';
import { Button, TextButton } from './kit';
import { space, type, useTheme } from './theme';

/**
 * The bar at the bottom of a list in Select mode (the screen's `footer`): how many rows are picked,
 * Select all or Deselect all, and what to do with them. An action does nothing until a row is picked.
 */
export function SelectBar({ count, total, onSelectAll, onClear, actions }: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  actions: { label: string; hint?: string; destructive?: boolean; onPress: () => void }[];
}) {
  const c = useTheme();
  const all = count > 0 && count === total;
  return (
    <View style={{ gap: space.s, paddingHorizontal: space.l, paddingTop: space.s }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, fontWeight: '600' }}>{selectedText(count)}</Text>
        <TextButton label={all ? 'Deselect all' : 'Select all'} onPress={all ? onClear : onSelectAll} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {actions.map((a) => (
          <Button
            key={a.label}
            size="small"
            variant={a.destructive ? 'destructive' : 'secondary'}
            label={a.label}
            hint={a.hint}
            disabled={count === 0}
            onPress={a.onPress}
            style={{ flex: 1 }}
          />
        ))}
      </View>
    </View>
  );
}
