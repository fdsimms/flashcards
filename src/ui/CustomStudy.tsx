import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { refreshFromKeptCollection } from '../anki/transfer';
import { runCustomStudy, type CustomStudyResult } from '../anki/customStudyService';
import { CustomStudyRefused } from '../anki/customStudyWrites';
import {
  CRAM_CHOICES, CUSTOM_STUDY_OPTIONS, customStudyFrom, customStudyProblem, type CramSelect, type CustomStudyKind,
} from '../core/customStudy';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Button, CheckRow, Card, ErrorNote, Field, Group, Help, Screen, Select } from './kit';
import { space } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/**
 * Anki's Custom Study for a deck: raise today's limits, or pick cards (forgotten, due soon, new,
 * by state or tag) into a "Custom Study Session" deck that is studied next. The work is
 * `runCustomStudy`; this is the sheet that asks for it.
 */
export function CustomStudy({ repo, deck, onStarted }: {
  repo: Repo & AnkiLink;
  deck: string;
  /** Called once it's done, with what happened: a limit raised, or the deck to study now. */
  onStarted: (result: CustomStudyResult) => void;
}) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [kind, setKind] = useState<CustomStudyKind>('moreNew');
  const option = CUSTOM_STUDY_OPTIONS.find((o) => o.kind === kind)!;
  const [amount, setAmount] = useState(String(option.field.start));
  const [select, setSelect] = useState<CramSelect>('new');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const choose = (k: CustomStudyKind) => {
    setKind(k);
    setAmount(String(CUSTOM_STUDY_OPTIONS.find((o) => o.kind === k)!.field.start));
    setError(undefined);
  };

  const start = async () => {
    const study = customStudyFrom(kind, Number(amount.trim()), { select, include, exclude });
    const problem = customStudyProblem(study);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(undefined);
    try {
      const result = await runCustomStudy(repo, deck, study, () => refreshFromKeptCollection(repo));
      haptic.success();
      onStarted(result);
    } catch (e) {
      setError(e instanceof CustomStudyRefused ? e.message : `Couldn't start custom study. ${e instanceof Error ? e.message : ''}`.trim());
      setBusy(false);
    }
  };

  const name = deck.split('::').pop();
  return (
    <Screen
      title="Custom study"
      largeTitle={false}
      lockGesture={busy}
      footer={<Button label={kind === 'moreNew' || kind === 'moreReviews' ? 'Increase limit' : 'Start studying'} onPress={start} busy={busy} />}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} keyboardShouldPersistTaps="handled" {...scrollProps}>
        <Help>For {name}. Cards you pick are studied in a deck called Custom Study Session.</Help>
        <Group accessibilityRole="radiogroup">
          {CUSTOM_STUDY_OPTIONS.map((o, i) => (
            <CheckRow key={o.kind} first={i === 0} label={o.title} hint={o.detail} selected={o.kind === kind} onPress={() => choose(o.kind)} />
          ))}
        </Group>
        <Card style={{ gap: space.m }}>
          <Field
            label={option.field.label}
            value={amount}
            onChangeText={(v) => { setAmount(v); setError(undefined); }}
            keyboardType="number-pad"
            returnKeyType="done"
          />
          {option.cram ? (
            <>
              <Select
                label="Cards to study"
                options={CRAM_CHOICES.map((x) => x.label)}
                value={CRAM_CHOICES.find((x) => x.select === select)!.label}
                onChange={(label) => setSelect(CRAM_CHOICES.find((x) => x.label === label)!.select)}
              />
              <Field label="Only these tags (optional)" value={include} onChangeText={setInclude} autoCapitalize="none" autoCorrect={false} placeholder="verb noun" />
              <Field label="Leave out these tags (optional)" value={exclude} onChangeText={setExclude} autoCapitalize="none" autoCorrect={false} />
            </>
          ) : null}
        </Card>
        {error ? <View><ErrorNote message={error} /></View> : null}
      </ScrollView>
    </Screen>
  );
}
