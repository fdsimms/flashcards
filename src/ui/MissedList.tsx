import React, { useState } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { haptic } from './haptics';
import { HoverPressable } from './hover';
import { Divider, Group } from './kit';
import { MIN_TAP, space, type, useTheme } from './theme';

/** How many missed rows the list shows before "Show all". */
const SHOWN = 5;

/** A missed row's box, for the row a caller draws: its padding, with `MissedDivider` as its first child. */
export const MISSED_ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m, minHeight: MIN_TAP };

/** The line above every missed row but the first, starting at its text. */
export function MissedDivider({ first }: { first: boolean }) {
  return first ? null : <Divider inset={space.l} />;
}

/**
 * At a session's end, what was missed (Review's words, WaniKani's items): a heading with how many,
 * the first few rows in a `Group`, and Show all for the rest. `row` draws one row; it spreads
 * `MISSED_ROW` and opens with `MissedDivider`, so both lists line up the same.
 */
export function MissedList<T>({ rows, row }: { rows: T[]; row: (item: T, first: boolean) => React.ReactNode }) {
  const c = useTheme();
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.l }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.l }}>
        <Text accessibilityRole="header" style={{ ...type.overline, color: c.textSecondary }}>Missed this session</Text>
        <Text style={{ ...type.overline, color: c.textSecondary }}>{rows.length}</Text>
      </View>
      <Group>
        {shown.map((item, i) => row(item, i === 0))}
        {rows.length > SHOWN ? (
          <HoverPressable
            onPress={() => { haptic.select(); setAll((v) => !v); }}
            accessibilityRole="button"
            style={({ pressed }) => ({ minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? c.fill : 'transparent' })}
          >
            <Divider inset={0} />
            <Text style={{ ...type.body, color: c.accentInk }}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Text>
          </HoverPressable>
        ) : null}
      </Group>
    </View>
  );
}
