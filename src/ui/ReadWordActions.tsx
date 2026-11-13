import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SFSymbol } from 'expo-symbols';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * The pieces of the reader's word popover that are tapped: the round play button beside the word
 * and the grouped list of actions under it, drawn like an iOS menu (an icon, a label, a chevron
 * where the row goes on to something) so each line reads as a button.
 */

export function WordPlayButton({ onPress }: { onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel="Play word"
      scaleTo={0.92}
      style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="play.fill" size={18} color={c.accent} weight="semibold" />
    </Tappable>
  );
}

export function WordActionGroup({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return <View style={{ marginTop: space.m, backgroundColor: c.fill, borderRadius: radius.m, overflow: 'hidden', ...smooth }}>{children}</View>;
}

const ICON = 20;

export function WordActionRow({ icon, label, accessibilityLabel, onPress, first, chevron = true }: {
  icon: SFSymbol;
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  /** The first row in a group has no divider above it. */
  first?: boolean;
  /** A row that does its job in place (a toggle) has no chevron. */
  chevron?: boolean;
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + space.xs, flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingHorizontal: space.m + space.xs, paddingVertical: space.s, backgroundColor: pressed ? c.border : 'transparent',
      })}
    >
      {first ? null : <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: space.m + space.xs + ICON + space.m, right: 0, height: hairline, backgroundColor: c.border }} />}
      <Icon name={icon} size={ICON} color={c.accent} />
      <Text style={{ ...type.body, color: c.text, flex: 1 }}>{label}</Text>
      {chevron ? <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" /> : null}
    </Pressable>
  );
}
