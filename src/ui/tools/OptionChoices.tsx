import React from 'react';
import { Text, View } from 'react-native';
import { Icon, Tappable } from '../kit';
import { hairline, radius, smooth, space, type, useTheme } from '../theme';

/**
 * A few buttons to pick one answer from (a syllable's tone, a letter's class, a vowel's length):
 * once one is picked they lock, the right one marked and a wrong pick marked too. `picked.choice`
 * is null when the answer was shown without picking.
 */
export function OptionChoices<T extends string>({ options, right, picked, onChoose }: {
  options: { value: T; label: string }[];
  right: T;
  picked: { choice: T | null } | null;
  onChoose: (value: T) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
      {options.map(({ value, label }) => {
        const isRight = !!picked && value === right;
        const isWrong = picked?.choice === value && value !== right;
        return (
          <Tappable
            key={value}
            onPress={() => onChoose(value)}
            disabled={!!picked}
            accessibilityRole="button"
            accessibilityLabel={`${label}${isRight ? ', right' : isWrong ? ', wrong' : ''}`}
            accessibilityState={{ selected: picked?.choice === value, disabled: !!picked }}
            scaleTo={0.97}
            style={{
              flexGrow: 1, flexBasis: 60, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs,
              paddingHorizontal: space.s, backgroundColor: c.surface, borderRadius: radius.m, ...smooth,
              borderWidth: isRight || isWrong ? 1.5 : hairline, borderColor: isRight ? c.countDue : isWrong ? c.danger : c.border,
            }}
          >
            <Text style={{ ...type.subhead, color: c.text, fontWeight: isRight ? '600' : '400' }}>{label}</Text>
            {isRight ? <Icon name="checkmark.circle.fill" size={16} color={c.countDue} /> : null}
            {isWrong ? <Icon name="xmark.circle.fill" size={16} color={c.danger} /> : null}
          </Tappable>
        );
      })}
    </View>
  );
}
