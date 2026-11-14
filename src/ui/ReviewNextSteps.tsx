import type { SFSymbol } from 'expo-symbols';
import React from 'react';
import { View } from 'react-native';
import { Group, NavRow, SectionTitle } from './kit';
import { space } from './theme';

export type NextStep = {
  key: string;
  label: string;
  icon: { name: SFSymbol; color: string };
  /** Said under the label while the step is being opened, which can wait on the server. */
  busy?: boolean;
  onPress: () => void;
};

/**
 * What a finished session offers to do next (practice the forms, the words missed, read a text, write
 * sentences, custom study), as a list of rows under the summary. It scrolls with the summary, so any
 * number of steps fits, and the screen's footer stays at the next deck and Back to decks.
 */
export function NextSteps({ steps }: { steps: NextStep[] }) {
  if (!steps.length) return null;
  return (
    <View style={{ alignSelf: 'stretch', gap: space.s, marginTop: space.l }}>
      <SectionTitle>Keep going</SectionTitle>
      <Group>
        {steps.map((s, i) => (
          <NavRow key={s.key} first={i === 0} icon={s.icon} label={s.label} detail={s.busy ? 'Opening…' : undefined} disabled={s.busy} onPress={s.onPress} />
        ))}
      </Group>
    </View>
  );
}
