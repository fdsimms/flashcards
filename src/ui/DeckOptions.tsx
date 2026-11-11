import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { DEFAULT_GATE_CAP } from '../core/config';
import { apprenticeCount, groupByDeck } from '../core/deckTree';
import { GURU, parseGateCap } from '../core/progress';
import type { DeckSettings } from '../core/types';
import type { Repo } from '../db/repo';
import { useTheme } from './theme';

/** Settings made in the app for one deck: so far, the progress gate. */
export function DeckOptions({ repo, deck, onDone }: { repo: Repo; deck: string; onDone: () => void }) {
  const t = useTheme();
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  const [capText, setCapText] = useState('');
  const [error, setError] = useState<string>();
  const [apprentice, setApprentice] = useState<number>();
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    (async () => {
      const [all, cards, notes] = await Promise.all([repo.listDeckSettings(), repo.listCards(deck), repo.listNotes()]);
      const s = all.get(deck) ?? {};
      setSettings(s);
      setCapText(String(s.gateCap ?? DEFAULT_GATE_CAP));
      setApprentice(apprenticeCount(deck, groupByDeck(cards, new Map(notes.map((n) => [n.id, n.deck])))));
    })();
  }, [repo, deck]);

  // Writes queue behind each other, so a quick toggle-then-edit can't land out of order.
  const save = (next: DeckSettings) => {
    setSettings(next);
    saving.current = saving.current.then(() => repo.saveDeckSettings(deck, next));
  };

  const toggle = (on: boolean) => {
    if (!settings) return;
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

  // A cap that can't be used keeps the screen open with its reason, rather than being dropped.
  const back = () => {
    if (settings?.gateCap !== undefined && 'error' in parseGateCap(capText)) { commitCap(); return; }
    commitCap();
    saving.current.then(onDone);
  };

  const on = settings?.gateCap !== undefined;
  const name = deck.split('::').pop();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 56 }}>
      <Pressable onPress={back} style={{ paddingHorizontal: 20 }}>
        <Text style={{ color: t.accent, fontSize: 16 }}>‹ Decks</Text>
      </Pressable>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: t.text, fontSize: 28, fontWeight: '700' }}>{name}</Text>
        <View style={{ backgroundColor: t.card, borderColor: t.border, borderWidth: 1, borderRadius: 14, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', flex: 1 }}>Limit cards in progress</Text>
            <Switch value={on} onValueChange={toggle} disabled={!settings} />
          </View>
          <Text style={{ color: t.sub }}>
            Show new cards only while fewer than this many cards in this deck and its subdecks are still in
            progress. A card stops counting once it reaches Guru, after {GURU - 1} correct reviews in a row. While
            this is on, the deck's daily new card limit doesn't apply.
          </Text>
          {on ? (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ color: t.text, flex: 1 }}>Most cards in progress</Text>
                <TextInput
                  value={capText}
                  onChangeText={(v) => { setCapText(v); setError(undefined); }}
                  onEndEditing={commitCap}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  style={{
                    color: t.text, borderColor: error ? t.again : t.border, borderWidth: 1, borderRadius: 8,
                    paddingHorizontal: 12, paddingVertical: 8, minWidth: 80, textAlign: 'right', fontSize: 17,
                  }}
                />
              </View>
              {error ? <Text style={{ color: t.again }}>{error}</Text> : null}
            </View>
          ) : null}
          {apprentice !== undefined ? (
            <Text style={{ color: t.sub }}>
              {apprentice === 1 ? '1 card is' : `${apprentice} cards are`} in progress in this deck now.
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
