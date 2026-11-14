import React from 'react';
import { Text, View } from 'react-native';
import { radius, smooth, space, type, useTheme } from './theme';

/**
 * Marks a card that has never been answered, so it's read and learned rather than recalled. Blue
 * like the deck's new count; a card's state is read from its schedule (state 0 is New).
 */
export function NewCardChip() {
  const c = useTheme();
  return (
    <View
      accessible
      accessibilityLabel="New card"
      style={{ alignSelf: 'center', backgroundColor: c.countNewFill, borderRadius: radius.pill, ...smooth, paddingHorizontal: space.m, paddingVertical: space.xs }}
    >
      <Text style={{ ...type.overline, color: c.countNew }}>New</Text>
    </View>
  );
}
