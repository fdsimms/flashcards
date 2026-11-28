import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { RegisterLevel } from '../../reader/registerLevel';
import { LANGUAGES } from '../../reader/languages';
import type { Partner, Rehearsal } from '../../reader/situations';
import { haptic } from '../haptics';
import { Button, Card, Help, Screen, Segments } from '../kit';
import { RegisterPicker } from '../reader/RegisterPicker';
import { Chip } from '../cram/CramThemes';
import { radius, readable, smooth, space, type, useTheme } from '../theme';
import { HandsFreeStart } from './HandsFreeBar';

/**
 * Situations opened from a cram or a theme (Rehearse): the scene is the cram's, so there's nothing to
 * pick, and Claude is asked to work its words in where they fit (never to require them). Start begins
 * the conversation (Talk hands-free, with the microphone opening by itself); Pick a different scene goes to the usual scene screen.
 */
export function SituationRehearse({ title, rehearsal, register, settingsRegister, onRegister, partner, onPartner, onStart, onPickOther }: {
  title: string;
  rehearsal: Rehearsal;
  /** This scene's own register: the cram's to begin with, until it's changed here. */
  register: RegisterLevel | undefined;
  settingsRegister: RegisterLevel | undefined;
  onRegister: (register: RegisterLevel | undefined) => void;
  /** Who Claude plays: the learner's tutor, or a person the scene calls for. */
  partner: Partner;
  onPartner: (partner: Partner) => void;
  /** `handsFree`: Talk hands-free was tapped rather than Start. */
  onStart: (handsFree: boolean) => void;
  onPickOther: () => void;
}) {
  const c = useTheme();
  const n = rehearsal.words.length;
  return (
    <Screen title={title} largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.m }}>
        <View style={{ backgroundColor: c.surface, borderRadius: radius.m, ...smooth, padding: space.l, gap: space.s, alignItems: 'center' }}>
          <Text style={{ ...type.overline, color: c.textSecondary }}>Your scene</Text>
          <Text style={{ ...type.title, color: c.text, textAlign: 'center' }}>{rehearsal.scene}</Text>
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Claude plays the other person using words from your deck, and tells you at the end what to fix.</Text>
          {n ? <Chip label={`Leaning on ${n} ${n === 1 ? 'word' : 'words'} from this cram`} ink={c.accentInk} fill={c.accentFill} /> : null}
          {rehearsal.prepared.length && partner === 'tutor' ? <Chip label="Asks about your talking points" ink={c.accentInk} fill={c.accentFill} /> : null}
        </View>
        <Card>
          <Segments<Partner>
            options={[{ value: 'tutor', label: 'Your tutor' }, { value: 'scene', label: 'A scene' }]}
            value={partner}
            onChange={onPartner}
          />
          <Help>{partner === 'tutor' ? `Claude is your tutor and asks you about "${rehearsal.scene}".` : `Claude plays a person from "${rehearsal.scene}", and you play the other part.`}</Help>
        </Card>
        <Card><RegisterPicker own={register} settings={settingsRegister} onChange={onRegister} /></Card>
        <Button label="Start" onPress={() => { haptic.tap(); onStart(false); }} />
        <HandsFreeStart speech={LANGUAGES[rehearsal.language].speech} onStart={() => onStart(true)} />
        <Button label="Pick a different scene" variant="secondary" onPress={() => { haptic.tap(); onPickOther(); }} />
      </ScrollView>
    </Screen>
  );
}
