import React from 'react';
import { View, type ViewStyle } from 'react-native';
import type { StateChip } from '../core/stateChip';
import { Tag } from './kit';
import { radius, space, useTheme } from './theme';

const NAMES = { new: 'New', learning: 'Learning', relearning: 'Relearning' } as const;

/**
 * What's shown above a card's question: New (never answered, so read and learned rather than
 * recalled), Learning or Relearning with the step it's on drawn as dots (filled up to the current
 * step), and Leech for a note tagged one. Colors follow the deck's counts (new blue, learning red);
 * a leech is the warning amber. A leech whose note has a mnemonic also says so in the accent gold (the
 * mnemonic itself shows on the back; it may name the answer). A Review card shows none. The card's state is read from its schedule.
 */
export function CardStateChips({ chip, leech, mnemonic = false, style }: { chip?: StateChip; leech: boolean; mnemonic?: boolean; style?: ViewStyle }) {
  const c = useTheme();
  if (!chip && !leech) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s, ...style }}>
      {chip ? (
        <Tag
          text={NAMES[chip.kind]}
          color={chip.kind === 'new' ? c.countNew : c.countLearn}
          fill={chip.kind === 'new' ? c.countNewFill : c.countLearnFill}
          accessibilityLabel={chip.step ? `${NAMES[chip.kind]} card, step ${chip.step.at} of ${chip.step.of}` : `${NAMES[chip.kind]} card`}
          icon={chip.kind === 'new' ? 'sparkle' : 'arrow.triangle.2.circlepath'}
          leading={chip.kind !== 'new' && chip.step ? (
            <View style={{ flexDirection: 'row', gap: 3 }}>
              {Array.from({ length: chip.step.of }, (_, i) => (
                <View key={i} style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: i < chip.step!.at ? c.countLearn : 'transparent', borderWidth: 1.5, borderColor: c.countLearn }} />
              ))}
            </View>
          ) : undefined}
        />
      ) : null}
      {leech ? <Tag text="Leech" color={c.warningInk} fill={c.warningFill} icon="exclamationmark.triangle.fill" iconColor={c.warning} accessibilityLabel="Leech: you keep forgetting this card" /> : null}
      {leech && mnemonic ? <Tag text="Has mnemonic" color={c.accentInk} fill={c.accentFill} icon="lightbulb.fill" accessibilityLabel="Has a mnemonic. It's on the back." /> : null}
    </View>
  );
}
