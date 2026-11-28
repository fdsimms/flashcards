import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, useColorScheme, View } from 'react-native';
import { loadFilteredDeck, saveFilteredDeckFor } from '../anki/filteredDeckService';
import { refreshFromKeptCollection } from '../anki/transfer';
import { failureText } from '../core/failure';
import { FILTERED_ORDERS, filteredDeckProblem, newFilteredDeck, SECOND_TERM, type FilteredDeckConfig } from '../core/filteredDeck';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import type { NoteStore } from '../anki/noteService';
import { haptic } from './haptics';
import { Button, Card, Field, Help, Loading, Screen, Section, SECTION_GAP, SwitchRow, Tappable } from './kit';
import { MIN_TAP, readable, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

type TermText = { search: string; limit: string; order: number };

/**
 * A filtered deck's settings (Anki's Create Filtered Deck, and a filtered deck's options): a name,
 * one search or two, each with a limit and an order, and whether answers reschedule. Build writes it
 * into the Anki collection and gathers its cards (`saveFilteredDeckFor`); `existing` names a deck
 * being changed, which Save rebuilds. `onBuilt` gets the deck's name as stored.
 */
export function FilteredDeckEditor({ repo, existing, initialSearch, onBuilt }: {
  repo: Repo & AnkiLink & NoteStore;
  existing?: string;
  initialSearch?: string;
  onBuilt: (deck: string) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const [base, setBase] = useState<FilteredDeckConfig>();
  const [name, setName] = useState('');
  const [terms, setTerms] = useState<TermText[]>([]);
  const [reschedule, setReschedule] = useState(true);
  const [problem, setProblem] = useState<string>();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    let live = true;
    const fill = (cfg: FilteredDeckConfig) => {
      if (!live) return;
      setBase(cfg);
      setName(cfg.name);
      setTerms(cfg.terms.map((t) => ({ search: t.search, limit: String(t.limit), order: t.order })));
      setReschedule(cfg.reschedule);
    };
    if (existing === undefined) fill(newFilteredDeck(initialSearch ?? ''));
    else loadFilteredDeck(repo, existing).then(fill, (e) => { if (live) setLoadError(failureText(e, { what: "Couldn't load this filtered deck.", next: 'Try again.' })); });
    return () => { live = false; };
  }, [repo, existing, initialSearch]);

  const config = (): FilteredDeckConfig => ({
    ...(base ?? newFilteredDeck()),
    name,
    terms: terms.map((t) => ({ search: t.search, limit: /^\d+$/.test(t.limit.trim()) ? Number(t.limit.trim()) : NaN, order: t.order })),
    reschedule,
  });
  const changed = !!base && JSON.stringify(config()) !== JSON.stringify(base);

  usePreventRemove(changed && !busy && !done.current, ({ repeat }) => {
    Alert.alert('Discard changes?', "If you leave now, they'll be lost.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: repeat },
    ]);
  });

  const editTerm = (i: number, change: Partial<TermText>) => {
    setTerms((all) => all.map((t, j) => (j === i ? { ...t, ...change } : t)));
    setProblem(undefined);
  };

  const build = async () => {
    if (busy) return;
    const cfg = config();
    const p = filteredDeckProblem(cfg);
    if (p) { setProblem(p); return; }
    setBusy(true);
    try {
      const saved = await saveFilteredDeckFor(repo, existing, cfg, () => refreshFromKeptCollection(repo));
      haptic.success();
      done.current = true;
      onBuilt(saved.name);
    } catch (e) {
      setProblem(failureText(e, { what: existing ? "Couldn't save the filtered deck." : "Couldn't build the filtered deck.", next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  const termCard = (t: TermText, i: number) => (
    <Card key={i}>
      <View style={{ gap: space.xs }}>
        <Field
          label={terms.length === 2 ? (i === 0 ? 'First search' : 'Second search') : 'Search'}
          value={t.search}
          onChangeText={(v) => editTerm(i, { search: v })}
          autoCapitalize="none"
          autoCorrect={false}
          code
          placeholder="e.g. deck:Polski is:due"
          editable={!busy}
        />
        {i === 0 ? (
          <Text style={{ ...type.footnote, color: c.textSecondary }}>
            Anki's search, e.g. deck:Polski is:due, tag:verbs is:new, or rated:7:1 (missed in the last 7 days). Suspended and buried cards, and cards already in a filtered deck, are left out.
          </Text>
        ) : null}
      </View>
      <Field label="Limit" value={t.limit} onChangeText={(v) => editTerm(i, { limit: v })} keyboardType="number-pad" returnKeyType="done" editable={!busy} />
      <View style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        <Text style={{ ...type.body, color: c.text, flex: 1 }}>Order</Text>
        <Host matchContents colorScheme={dark ? 'dark' : 'light'} seedColor={c.accent}>
          <Picker label="Order" modifiers={[pickerStyle('menu')]} selection={t.order} onSelectionChange={(o: number) => { haptic.select(); editTerm(i, { order: o }); }}>
            {FILTERED_ORDERS.map((o) => <SwiftText key={o.value} modifiers={[tag(o.value)]}>{o.label}</SwiftText>)}
          </Picker>
        </Host>
      </View>
      {i === 1 ? <Tappable onPress={() => { haptic.tap(); setTerms((all) => all.slice(0, 1)); }} disabled={busy}><Text style={{ ...type.body, color: c.danger }}>Remove the second search</Text></Tappable> : null}
    </Card>
  );

  return (
    <Screen
      title={existing ? 'Filtered deck' : 'New filtered deck'}
      footer={base ? <Button label={existing ? 'Save and rebuild' : 'Build'} onPress={build} busy={busy} disabled={existing !== undefined && !changed} /> : undefined}
    >
      {!base ? <Loading error={loadError} /> : (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.xl + bottomPadding, gap: SECTION_GAP }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...scrollProps}>
          <Card>
            <Field label="Name" value={name} onChangeText={(v) => { setName(v); setProblem(undefined); }} placeholder="e.g. Polski missed this week" editable={!busy} />
          </Card>
          <Section title="Cards">
            <View style={{ gap: space.m }}>
              {terms.map(termCard)}
              {terms.length === 1 ? (
                <Tappable onPress={() => { haptic.tap(); setTerms((all) => [...all, { search: SECOND_TERM.search, limit: String(SECOND_TERM.limit), order: SECOND_TERM.order }]); }} disabled={busy}>
                  <Text style={{ ...type.body, color: c.accentInk }}>Add a second search</Text>
                </Tappable>
              ) : null}
            </View>
          </Section>
          <Card>
            <SwitchRow
              first
              label="Reschedule cards based on my answers"
              hint="Off, it's a preview: answers don't change when cards are due."
              value={reschedule}
              onValueChange={(on) => { setReschedule(on); setProblem(undefined); }}
            />
          </Card>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          {existing ? <Help>Saving empties the deck and gathers its cards again with these settings.</Help> : null}
        </ScrollView>
      )}
    </Screen>
  );
}
