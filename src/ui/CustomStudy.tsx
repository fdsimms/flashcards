import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { refreshFromKeptCollection } from '../anki/transfer';
import { runCustomStudy, type CustomStudyResult } from '../anki/customStudyService';
import {
  CRAM_CHOICES, CUSTOM_STUDY_OPTIONS, customStudyFrom, customStudyProblem, type CramSelect, type CustomStudyKind,
} from '../core/customStudy';
import { failureText } from '../core/failure';
import { parseTags } from '../core/noteEditing';
import { tagCounts, type TagSuggestion } from '../core/priority';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Button, CheckRow, Card, ErrorNote, Field, Group, Help, Screen, Select } from './kit';
import { TagTokenField } from './TagTokenField';
import { space, readable } from './theme';
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
  // The keyboard's height pads the whole screen, not just the list, so the footer's button stays above it.
  const { scrollProps, bottomPadding: keyboard } = useKeyboardScroll();
  const insets = useSafeAreaInsets();
  const [kind, setKind] = useState<CustomStudyKind>('moreNew');
  const option = CUSTOM_STUDY_OPTIONS.find((o) => o.kind === kind)!;
  const [amount, setAmount] = useState(String(option.field.start));
  const [select, setSelect] = useState<CramSelect>('new');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  // Every tag in the collection, to suggest in the two tag fields.
  const [counts, setCounts] = useState<TagSuggestion[]>([]);
  useEffect(() => {
    let current = true;
    repo.listNotes().then((notes) => { if (current) setCounts(tagCounts(notes)); }).catch(() => undefined);
    return () => { current = false; };
  }, [repo]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Only the two limits work without an Anki collection: the others build a filtered deck in it.
  const [hasAnki, setHasAnki] = useState(true);
  useEffect(() => {
    let current = true;
    repo.keptCollection().then((kept) => { if (current) setHasAnki(!!kept); }).catch(() => undefined);
    return () => { current = false; };
  }, [repo]);
  const offered = hasAnki ? CUSTOM_STUDY_OPTIONS : CUSTOM_STUDY_OPTIONS.filter((o) => o.kind === 'moreNew' || o.kind === 'moreReviews');

  const choose = (k: CustomStudyKind) => {
    setKind(k);
    setAmount(String(CUSTOM_STUDY_OPTIONS.find((o) => o.kind === k)!.field.start));
    setError(undefined);
  };

  // Set from the first tap until it fails: a second tap landing before the button shows it's busy
  // would raise the limit twice, or build the deck again, and close the screen behind Review too.
  const starting = useRef(false);
  const start = async () => {
    if (starting.current) return;
    const study = customStudyFrom(kind, Number(amount.trim()), { select, include, exclude });
    const problem = customStudyProblem(study);
    if (problem) { setError(problem); return; }
    starting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await runCustomStudy(repo, deck, study, () => refreshFromKeptCollection(repo));
      haptic.success();
      onStarted(result);
    } catch (e) {
      setError(failureText(e, { what: "Couldn't start custom study.", next: 'Try again.' }));
      starting.current = false;
      setBusy(false);
    }
  };

  const name = deck.split('::').pop();
  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
    <Screen
      title="Custom study"
      largeTitle={false}
      lockGesture={busy}
      footer={<Button label={kind === 'moreNew' || kind === 'moreReviews' ? 'Increase limit' : 'Start studying'} onPress={start} busy={busy} />}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} keyboardShouldPersistTaps="handled" {...scrollProps}>
        <Help>{kind === 'moreNew' || kind === 'moreReviews' ? `For ${name}. The new limit applies today only.` : `For ${name}. Cards you pick are studied in a deck called Custom Study Session.`}</Help>
        <Group accessibilityRole="radiogroup">
          {offered.map((o, i) => (
            <CheckRow key={o.kind} first={i === 0} label={o.title} hint={o.detail} selected={o.kind === kind} onPress={() => choose(o.kind)} />
          ))}
        </Group>
        {hasAnki ? null : <Help>Reviewing forgotten cards, reviewing ahead, previewing and studying by state or tag need an Anki collection (Settings, Anki).</Help>}
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
              <TagTokenField label="Only these tags (optional)" tags={parseTags(include)} onChange={(t) => setInclude(t.join(' '))} counts={counts} placeholder="Add a tag" />
              <TagTokenField label="Leave out these tags (optional)" tags={parseTags(exclude)} onChange={(t) => setExclude(t.join(' '))} counts={counts} placeholder="Add a tag" />
            </>
          ) : null}
        </Card>
        {error ? <View><ErrorNote message={error} /></View> : null}
      </ScrollView>
    </Screen>
    </View>
  );
}
