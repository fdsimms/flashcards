import React from 'react';
import { Text, View } from 'react-native';
import { Button, Help } from '../kit';
import { space, type, useTheme } from '../theme';

export type KeepState = 'idle' | 'saving' | 'kept' | 'failed';

/**
 * Under a rehearsal's corrections: Keep these puts the lines that needed a fix on this phone
 * (src/reader/corrections.ts), where Theme ideas reads them to aim the next themes. Nothing is added to
 * the deck, and nothing is graded.
 */
export function SituationKeep({ count, state, onKeep }: { count: number; state: KeepState; onKeep: () => void }) {
  const c = useTheme();
  const what = `${count} ${count === 1 ? 'correction' : 'corrections'}`;
  if (state === 'kept') {
    return (
      <View style={{ backgroundColor: c.goodFill, borderRadius: 12, padding: space.m }}>
        <Text style={{ ...type.subhead, color: c.goodInk }}>{`Kept ${what}. Your next theme ideas will use them.`}</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: space.s }}>
      <Text style={{ ...type.headline, color: c.text }}>Keep these mistakes?</Text>
      <Help>Franki uses them when it suggests your next themes. They aren't added to your deck.</Help>
      {state === 'failed' ? <Text style={{ ...type.subhead, color: c.danger }}>{"Couldn't keep them. Try again."}</Text> : null}
      <Button label="Keep these" variant="secondary" onPress={onKeep} busy={state === 'saving'} />
    </View>
  );
}
