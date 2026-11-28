import React from 'react';
import { Text, View } from 'react-native';
import { candidateChips, type LessonWordCandidate } from '../../core/lessonWords';
import { Icon, Tappable } from '../kit';
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
      hitSlop={{ top: 2, bottom: 2 }}
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

/**
 * How common a looked-up word is and how it is said, as small chips under its meaning (Add, Make cards, Add a word). Claude's
 * judgment, not a dictionary's, so the screens that show it say so. Nothing when there is nothing worth saying.
 */
export function CandidateChips({ word }: { word: LessonWordCandidate }) {
  const c = useTheme();
  const chips = candidateChips(word);
  if (!chips.length) return null;
  const ink = { plain: c.textSecondary, good: c.goodInk, note: c.warningInk } as const;
  const fill = { plain: c.surface, good: c.goodFill, note: c.warningFill } as const;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2, paddingTop: 2 }}>
      {chips.map((chip) => (
        <View key={chip.label} style={{ backgroundColor: fill[chip.tone], borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: space.s }}>
          <Text style={{ ...type.caption, color: ink[chip.tone] }}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}
