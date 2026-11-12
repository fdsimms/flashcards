import { usePreventRemove } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { DEFAULT_GATE_CAP } from '../core/config';
import { groupByDeck, inProgressCount } from '../core/deckTree';
import { GURU_INTERVAL_DAYS, parseGateCap } from '../core/progress';
import type { DeckSettings } from '../core/types';
import type { Repo } from '../db/repo';
import { haptic } from './haptics';
import { Card, Help, Screen } from './kit';
import { hairline, radius, smooth, space, type, useTheme } from './theme';

/** Settings made in the app for one deck: so far, the progress gate. */
export function DeckOptions({ repo, deck }: { repo: Repo; deck: string }) {
  const c = useTheme();
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [capText, setCapText] = useState('');
  const [error, setError] = useState<string>();
  const [inProgress, setInProgress] = useState<number>();
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    (async () => {
      const [all, cards, notes] = await Promise.all([repo.listDeckSettings(), repo.listCards(deck), repo.listNotes()]);
      const s = all.get(deck) ?? {};
      setSettings(s);
      setCapText(String(s.gateCap ?? DEFAULT_GATE_CAP));
      setInProgress(inProgressCount(deck, groupByDeck(cards, new Map(notes.map((n) => [n.id, n.deck])))));
    })();
  }, [repo, deck]);

  // Writes queue behind each other, so a quick toggle-then-edit can't land out of order.
  const save = (next: DeckSettings) => {
    setSettings(next);
    saving.current = saving.current.then(() => repo.saveDeckSettings(deck, next));
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
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
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
                  keyboardType="number-pad"
                  returnKeyType="done"
                  accessibilityLabel="Most cards in progress"
                  style={{
                    ...type.body, color: c.text, backgroundColor: c.fill,
                    borderColor: error ? c.danger : 'transparent', borderWidth: 1.5, borderRadius: radius.m, ...smooth,
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
      </ScrollView>
    </Screen>
  );
}
