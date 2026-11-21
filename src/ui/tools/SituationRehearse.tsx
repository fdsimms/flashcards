import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { RegisterLevel } from '../../reader/registerLevel';
import type { Rehearsal } from '../../reader/situations';
import { haptic } from '../haptics';
import { Button, Card, Screen } from '../kit';
import { RegisterPicker } from '../reader/RegisterPicker';
import { Chip } from '../cram/CramThemes';
import { readable, space, type, useTheme } from '../theme';

/**
 * Situations opened from a cram or a theme (Rehearse): the scene is the cram's, so there's nothing to
 * pick, and Claude is asked to work its words in where they fit (never to require them). Start begins
 * the conversation; Pick a different scene goes to the usual scene screen.
 */
export function SituationRehearse({ title, rehearsal, register, settingsRegister, onRegister, onStart, onPickOther }: {
  title: string;
  rehearsal: Rehearsal;
  /** This scene's own register: the cram's to begin with, until it's changed here. */
  register: RegisterLevel | undefined;
  settingsRegister: RegisterLevel | undefined;
  onRegister: (register: RegisterLevel | undefined) => void;
  onStart: () => void;
  onPickOther: () => void;
}) {
  const c = useTheme();
  const n = rehearsal.words.length;
  return (
    <Screen title={title} largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <View style={{ backgroundColor: c.surface, borderRadius: 12, padding: space.l, gap: space.s, alignItems: 'center' }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>Your scene</Text>
          <Text style={{ ...type.title, color: c.text, textAlign: 'center' }}>{rehearsal.scene}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Claude plays the other person using words from your deck, and tells you at the end what to fix.</Text>
          {n ? <Chip label={`Leaning on ${n} ${n === 1 ? 'word' : 'words'} from this cram`} ink={c.accentInk} fill={c.accentFill} /> : null}
        </View>
        <Card><RegisterPicker own={register} settings={settingsRegister} onChange={onRegister} /></Card>
        <Button label="Start" onPress={() => { haptic.tap(); onStart(); }} />
        <Button label="Pick a different scene" variant="secondary" onPress={() => { haptic.tap(); onPickOther(); }} />
      </ScrollView>
    </Screen>
  );
}
