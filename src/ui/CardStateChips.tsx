import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import type { StateChip } from '../core/stateChip';
import { Icon } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

const NAMES = { new: 'New', learning: 'Learning', relearning: 'Relearning' } as const;

/**
 * What's shown above a card's question: New (never answered, so read and learned rather than
 * recalled), Learning or Relearning with the step it's on drawn as dots (filled up to the current
 * step), and Leech for a note tagged one. Colors follow the deck's counts (new blue, learning red);
 * a leech is the warning amber. A leech whose note has a mnemonic also says so in the accent gold (the
 * mnemonic itself shows on the back; it may name the answer). A Review card shows none. The card's state is read from its schedule.
 */
export function CardStateChips({ chip, leech, mnemonic = false, cram, style }: { chip?: StateChip; leech: boolean; mnemonic?: boolean; cram?: string; style?: ViewStyle }) {
  const c = useTheme();
  if (!chip && !leech && !cram) return null;
  const pill = { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, borderRadius: radius.pill, ...smooth, paddingHorizontal: space.m, paddingVertical: space.xs } as const;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, ...style }}>
      {chip ? (
        <View
          accessible
          accessibilityLabel={chip.step ? `${NAMES[chip.kind]} card, step ${chip.step.at} of ${chip.step.of}` : `${NAMES[chip.kind]} card`}
          style={{ ...pill, backgroundColor: chip.kind === 'new' ? c.countNewFill : c.countLearnFill }}
        >
          {chip.kind === 'new' ? <Icon name="sparkle" size={12} color={c.countNew} /> : chip.step ? (
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {Array.from({ length: chip.step.of }, (_, i) => (
                <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i < chip.step!.at ? c.countLearn : 'transparent', borderWidth: i < chip.step!.at ? 0 : 1.5, borderColor: c.countLearn }} />
              ))}
            </View>
          ) : <Icon name="arrow.triangle.2.circlepath" size={12} color={c.countLearn} />}
          <Text style={{ ...type.overline, color: chip.kind === 'new' ? c.countNew : c.countLearn }}>{NAMES[chip.kind]}</Text>
        </View>
      ) : null}
      {leech ? (
        <View accessible accessibilityLabel="Leech: this card keeps being forgotten" style={{ ...pill, backgroundColor: c.warningFill }}>
          <Icon name="exclamationmark.triangle.fill" size={12} color={c.warning} />
          <Text style={{ ...type.overline, color: c.warningInk }}>Leech</Text>
        </View>
      ) : null}
      {cram ? (
        <View accessible accessibilityLabel={`${cram}. This card comes back a few more times in this session, and doesn't change its schedule.`} style={{ ...pill, backgroundColor: c.accentFill }}>
          <Icon name="repeat" size={12} color={c.accentInk} />
          <Text style={{ ...type.overline, color: c.accentInk }}>{cram}</Text>
        </View>
      ) : null}
      {leech && mnemonic ? (
        <View accessible accessibilityLabel="Has a mnemonic. It's on the back." style={{ ...pill, backgroundColor: c.accentFill }}>
          <Icon name="lightbulb.fill" size={12} color={c.accentInk} />
          <Text style={{ ...type.overline, color: c.accentInk }}>Has mnemonic</Text>
        </View>
      ) : null}
    </View>
  );
}
