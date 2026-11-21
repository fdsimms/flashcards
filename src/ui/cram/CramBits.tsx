import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Divider, Icon, Tappable } from '../kit';
import { MIN_TAP, radius, space, type, useTheme } from '../theme';

/**
 * The small pieces the cram screens share: a pill to tap (a day on the new cram's sheet, a
 * suggestion on the cram's page) and a row with a check circle (Start with, Add, lesson mode), so
 * the four screens that check things off draw them the same way.
 */

/** A tappable pill. `selected` fills it with the accent; `ink` and `fill` color an unselected one (a suggestion's kind). */
export function Pill({ label, selected, onPress, ink, fill, icon, accessibilityLabel }: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  ink?: string;
  fill?: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  accessibilityLabel?: string;
}) {
  const c = useTheme();
  const color = selected ? c.onAccent : ink ?? c.text;
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      scaleTo={0.95}
      style={{
        minHeight: MIN_TAP - 4, flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, paddingHorizontal: space.m + 2,
        borderRadius: radius.pill, backgroundColor: selected ? c.accent : fill ?? c.surface,
      }}
    >
      {icon ? <Icon name={icon} size={14} color={color} weight="semibold" /> : null}
      <Text style={{ ...type.subhead, color, fontWeight: selected || ink ? '600' : '400' }}>{label}</Text>
    </Tappable>
  );
}

/** A row in a `Group` with a check circle: tapping it checks it or takes the check off. `big` is lesson mode's, for a glance mid-conversation. */
export function CheckRow({ label, detail, checked, onPress, first, big, color, trailing, disabled, labelSize }: {
  label: string;
  detail?: string;
  checked: boolean;
  onPress: () => void;
  first?: boolean;
  big?: boolean;
  /** The check's fill when on: the accent, unless this says otherwise (lesson mode's green). */
  color?: string;
  /** Something small after the text ("Saving"). */
  trailing?: React.ReactNode;
  disabled?: boolean;
  /** Replaces the label's size and line height (a cram's text size, for a label in the cram's language). */
  labelSize?: { fontSize: number; lineHeight: number };
}) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP + (big ? space.l : space.m), flexDirection: 'row', alignItems: 'center', gap: space.m,
        paddingVertical: big ? space.m : space.s + 2, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : 'transparent',
      })}
    >
      {first ? null : <Divider inset={space.l} />}
      <Icon name={checked ? 'checkmark.circle.fill' : 'circle'} size={big ? 26 : 22} color={checked ? color ?? c.accent : c.textTertiary} weight="regular" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...(big ? type.headline : type.body), ...labelSize, color: checked && big ? c.textSecondary : c.text }}>{label}</Text>
        {detail ? <Text numberOfLines={2} style={{ ...(big ? type.subhead : type.footnote), color: c.textSecondary }}>{detail}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}
