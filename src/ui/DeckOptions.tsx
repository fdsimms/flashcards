import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, useColorScheme, View } from 'react-native';
import { DEFAULT_GATE_CAP } from '../core/config';
import { failureText } from '../core/failure';
import { groupByDeck, inProgressCount } from '../core/deckTree';
import { GURU_INTERVAL_DAYS, parseGateCap } from '../core/progress';
import { paramsForDeck } from '../core/scheduler';
import type { DeckSettings } from '../core/types';
import type { Repo } from '../db/repo';
import type { RecordDeps } from '../anki/recordService';
import { DeckFormsOptions } from './DeckFormsOptions';
import { DeckPriorityOptions } from './DeckPriorityOptions';
import { DeckRecordings } from './DeckRecordings';
import { haptic } from './haptics';
import { Card, Group, Help, Loading, NavRow, Screen } from './kit';
import { hairline, radius, smooth, space, type, useTheme } from './theme';
import { useKeyboardScroll } from './useKeyboardScroll';

/** Settings made in the app for one deck: the progress gate, forms practice, lookalike words and recordings. */
export function DeckOptions({ repo, deck, onCustomStudy, recorder }: { repo: Repo; deck: string; onCustomStudy: () => void; recorder: RecordDeps | null }) {
  const { scrollProps, bottomPadding } = useKeyboardScroll();
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [capFocused, setCapFocused] = useState(false);
  const [capText, setCapText] = useState('');
  const [error, setError] = useState<string>();
  const [inProgress, setInProgress] = useState<number>();
  // An Anki filtered deck has no limits or cards of its own to add to, so custom study isn't offered on it.
  const [filtered, setFiltered] = useState(false);
  // Every deck's settings, for what this deck inherits from the decks above it.
  const [all, setAll] = useState<Map<string, DeckSettings>>(new Map());
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    setLoadError(null);
    (async () => {
      const [all, cards, notes, params] = await Promise.all([repo.listDeckSettings(), repo.listCards(deck), repo.listNotes(), repo.listDeckParams()]);
      setFiltered(!!paramsForDeck(deck, params)?.filtered);
      const s = all.get(deck) ?? {};
      setAll(all);
      setSettings(s);
      setCapText(String(s.gateCap ?? DEFAULT_GATE_CAP));
      setInProgress(inProgressCount(deck, groupByDeck(cards, new Map(notes.map((n) => [n.id, n.deck])))));
    })().catch((e) => setLoadError(failureText(e, { what: "Couldn't load this deck's options.", next: 'Try again.' })));
  }, [repo, deck, attempt]);

  // Writes queue behind each other, so a quick toggle-then-edit can't land out of order. A failed
  // write is said and the queue goes on, so later saves (and leaving the screen) aren't stuck behind it.
  const save = (next: DeckSettings) => {
    setSettings(next);
    saving.current = saving.current
      .then(() => repo.saveDeckSettings(deck, next))
      .catch((e) => Alert.alert("Couldn't save this setting", failureText(e, { next: 'Try again.' })));
  };

  const toggle = (on: boolean) => {
    if (!settings) return;
    haptic.select();
    if (!on) { save({ ...settings, gateCap: undefined }); setError(undefined); return; }
    const parsed = parseGateCap(capText);
    save({ ...settings, gateCap: 'cap' in parsed ? parsed.cap : DEFAULT_GATE_CAP });
    if (!('cap' in parsed)) setCapText(String(DEFAULT_GATE_CAP));
    setError(undefined);
  };

  const commitCap = () => {
    if (!settings || settings.gateCap === undefined) return;
    const parsed = parseGateCap(capText);
    if ('error' in parsed) { setError(parsed.error); return; }
    setError(undefined);
    if (parsed.cap !== settings.gateCap) save({ ...settings, gateCap: parsed.cap });
  };

  // Leaving with a cap still being typed saves it first, once the save has landed so the deck list
  // reads it. A cap that can't be used keeps the screen open with its reason, rather than being dropped.
  const typing = settings?.gateCap !== undefined && capText !== String(settings.gateCap);
  usePreventRemove(typing, ({ repeat }) => {
    const parsed = parseGateCap(capText);
    if ('error' in parsed) { setError(parsed.error); return; }
    setError(undefined);
    if (settings) save({ ...settings, gateCap: parsed.cap });
    saving.current.then(repeat);
  });

  const on = settings?.gateCap !== undefined;
  const name = deck.split('::').pop();
  return (
    <Screen title={name}>
      {!settings ? <Loading error={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : (
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l + bottomPadding, gap: space.m }} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" {...scrollProps}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>Limit cards in progress</Text>
            <Switch value={on} onValueChange={toggle} disabled={!settings} trackColor={{ true: c.accent, false: c.border }} ios_backgroundColor={c.border} accessibilityLabel="Limit cards in progress" />
          </View>
          <Help>
            Show new cards only while fewer than this many cards in this deck and its subdecks are still in progress. A card
            stops counting once its next review is {GURU_INTERVAL_DAYS} days or more away, and counts again if you forget it.
            While this is on, the deck's daily new card limit doesn't apply.
          </Help>
          {on ? (
            <View style={{ gap: space.xs, borderTopWidth: hairline, borderTopColor: c.border, paddingTop: space.m }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
                <Text style={{ ...type.body, color: c.text, flex: 1 }}>Most cards in progress</Text>
                <TextInput
                  value={capText}
                  onChangeText={(v) => { setCapText(v); setError(undefined); }}
                  onEndEditing={commitCap}
                  onFocus={() => setCapFocused(true)}
                  onBlur={() => setCapFocused(false)}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  keyboardAppearance={dark ? 'dark' : 'light'}
                  selectionColor={c.accent}
                  accessibilityLabel="Most cards in progress"
                  style={{
                    ...type.body, color: c.text, backgroundColor: c.fill,
                    borderColor: error ? c.danger : capFocused ? c.accent : 'transparent', borderWidth: 1.5, borderRadius: radius.m, ...smooth,
                    paddingHorizontal: space.m, paddingVertical: space.s, minWidth: 88, textAlign: 'right',
                  }}
                />
              </View>
              {error ? <Text style={{ ...type.subhead, color: c.danger }}>{error}</Text> : null}
            </View>
          ) : null}
        </Card>
        {inProgress !== undefined ? (
          <Help>{inProgress === 1 ? '1 card is' : `${inProgress} cards are`} in progress in this deck and its subdecks now.</Help>
        ) : null}
        {filtered ? null : (
          <Group>
            <NavRow first label="Custom study" detail="Study more today, or pick cards to study now" onPress={onCustomStudy} />
          </Group>
        )}
        {settings ? <DeckPriorityOptions deck={deck} all={new Map(all).set(deck, settings)} onChange={(patch) => save({ ...settings, ...patch })} /> : null}
        {settings ? <DeckFormsOptions deck={deck} all={new Map(all).set(deck, settings)} onChange={(patch) => save({ ...settings, ...patch })} /> : null}
        {filtered ? null : <DeckRecordings repo={repo} deck={deck} recorder={recorder} />}
      </ScrollView>
      )}
    </Screen>
  );
}
