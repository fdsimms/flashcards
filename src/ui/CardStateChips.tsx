import React from 'react';
import { Text, View } from 'react-native';
import type { StateChip } from '../core/stateChip';
import { Icon } from './kit';
import { radius, smooth, space, type, useTheme } from './theme';

const NAMES = { new: 'New', learning: 'Learning', relearning: 'Relearning' } as const;

/**
 * What's shown above a card's question: New (never answered, so read and learned rather than
 * recalled), Learning or Relearning with the step it's on drawn as dots (filled up to the current
 * step), and Leech for a note tagged one. Colors follow the deck's counts (new blue, learning red);
 * a leech is the warning amber. A Review card shows none. The card's state is read from its schedule.
 */
export function CardStateChips({ chip, leech }: { chip?: StateChip; leech: boolean }) {
  const c = useTheme();
  if (!chip && !leech) return null;
  const pill = { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, borderRadius: radius.pill, ...smooth, paddingHorizontal: space.m, paddingVertical: space.xs } as const;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
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
          <Text style={{ ...type.overline, color: c.warning }}>Leech</Text>
        </View>
      ) : null}
    </View>
  );
}
