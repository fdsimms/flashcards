import React from 'react';
import { Text, View } from 'react-native';
import { selectedText } from '../core/selection';
import { Tappable, TextButton } from './kit';
import { MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * The bar at the bottom of a list in Select mode (the screen's `footer`): how many rows are picked,
 * Select all or Deselect all, and what to do with them. An action does nothing until a row is picked.
 * `status` is a line saying what the last action did, with Undo for it when it can be taken back.
 */
export function SelectBar({ count, total, onSelectAll, onClear, actions, status }: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  actions: { label: string; hint?: string; destructive?: boolean; onPress: () => void }[];
  status?: { text: string; onUndo?: () => void };
}) {
  const c = useTheme();
  const all = count > 0 && count === total;
  return (
    <View style={{ gap: space.s, paddingHorizontal: space.l, paddingTop: space.s }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...type.subhead, color: c.textSecondary, fontWeight: '600' }}>{selectedText(count)}</Text>
        <TextButton label={all ? 'Deselect all' : 'Select all'} onPress={all ? onClear : onSelectAll} />
      </View>
      {status ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s }}>
          <Text accessibilityLiveRegion="polite" style={{ ...type.subhead, color: c.goodInk, flex: 1 }}>{status.text}</Text>
          {status.onUndo ? <TextButton label="Undo" onPress={status.onUndo} /> : null}
        </View>
      ) : null}
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
