import React from 'react';
import { Text, View } from 'react-native';
import { selectedText } from '../core/selection';
import { haptic } from './haptics';
import { Tappable } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

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
        <Tappable
          onPress={() => { haptic.tap(); (all ? onClear : onSelectAll)(); }}
          accessibilityRole="button"
          style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
        >
          <Text style={{ ...type.subhead, color: c.accentInk, fontWeight: '600' }}>{all ? 'Deselect all' : 'Select all'}</Text>
        </Tappable>
      </View>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        {actions.map((a) => (
          <Tappable
            key={a.label}
            disabled={count === 0}
            restOpacity={count === 0 ? 0.4 : 1}
            onPress={a.onPress}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            style={{ flex: 1, minHeight: MIN_TAP, borderRadius: radius.m, ...smooth, paddingVertical: space.s, paddingHorizontal: space.s, alignItems: 'center', justifyContent: 'center', backgroundColor: a.destructive ? c.dangerFill : c.fill }}
          >
            <Text style={{ ...type.subhead, fontWeight: '600', color: a.destructive ? c.danger : c.text, textAlign: 'center' }}>{a.label}</Text>
            {a.hint ? <Text style={{ ...type.caption, color: a.destructive ? c.danger : c.textSecondary, textAlign: 'center' }}>{a.hint}</Text> : null}
          </Tappable>
        ))}
      </View>
    </View>
  );
}
