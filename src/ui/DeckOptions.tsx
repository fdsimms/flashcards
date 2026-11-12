import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { DEFAULT_GATE_CAP } from '../core/config';
import { groupByDeck, inProgressCount } from '../core/deckTree';
import { FORM_PROMPT_CHOICES, formsSettings } from '../core/forms';
import { LOOKALIKE_DAY_CHOICES, lookalikeSettings } from '../core/lookalikes';
import { GURU_INTERVAL_DAYS, parseGateCap } from '../core/progress';
import type { DeckSettings } from '../core/types';
import type { Repo } from '../db/repo';
import { Card, Chip, Help, NavRow, Screen } from './kit';
import { radius, space, type, useTheme } from './theme';

/** Settings made in the app for one deck: the progress gate, forms practice and lookalike words. */
export function DeckOptions({ repo, deck, onDone, onPractice }: { repo: Repo; deck: string; onDone: () => void; onPractice: () => void }) {
  const c = useTheme();
  const [settings, setSettings] = useState<DeckSettings | null>(null);
  // Every deck's settings, for what this deck inherits from the decks above it.
  const [allSettings, setAllSettings] = useState<Map<string, DeckSettings>>(new Map());
  const [capText, setCapText] = useState('');
  const [error, setError] = useState<string>();
  const [inProgress, setInProgress] = useState<number>();
  const saving = useRef(Promise.resolve());

  useEffect(() => {
    (async () => {
      const [all, cards, notes] = await Promise.all([repo.listDeckSettings(), repo.listCards(deck), repo.listNotes()]);
      const s = all.get(deck) ?? {};
      setAllSettings(all);
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
  // What applies here: this deck's own choices over what it inherits.
  const effective = new Map(allSettings).set(deck, settings ?? {});
  const forms = formsSettings(deck, effective);
  const look = lookalikeSettings(deck, effective);
  const set = (patch: DeckSettings) => { if (settings) save({ ...settings, ...patch }); };
  return (
    <Screen onBack={back} title={name}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>Limit cards in progress</Text>
            <Switch value={on} onValueChange={toggle} disabled={!settings} trackColor={{ true: c.accent }} accessibilityLabel="Limit cards in progress" />
          </View>
          <Help>
            Show new cards only while fewer than this many cards in this deck and its subdecks are still in progress. A card
            stops counting once its next review is {GURU_INTERVAL_DAYS} days or more away, and counts again if you forget it.
            While this is on, the deck's daily new card limit doesn't apply.
          </Help>
          {on ? (
            <View style={{ gap: space.xs, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.m }}>
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
                    borderColor: error ? c.danger : 'transparent', borderWidth: 1, borderRadius: radius.s,
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

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>Suggest forms practice</Text>
            <Switch value={forms.suggest} onValueChange={(v) => set({ suggestForms: v })} disabled={!settings} trackColor={{ true: c.accent }} accessibilityLabel="Suggest forms practice" />
          </View>
          <Help>
            Suggested on a card's answer side only when there's a reason: a word new this week, one whose forms you missed
            last time, or one you haven't practiced in a month. Words whose notes don't list their forms are never
            suggested. Practice never changes when a card is due.
          </Help>
          <View style={{ gap: space.s, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.m }}>
            <Text style={{ ...type.body, color: c.text }}>Prompts each time</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {FORM_PROMPT_CHOICES.map((n) => (
                <Chip key={n} label={String(n)} selected={forms.prompts === n} onPress={() => set({ formPrompts: n })} />
              ))}
            </View>
          </View>
          <NavRow label="Practice forms" detail="Practice one pattern across the words you've studied" onPress={onPractice} />
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <Text style={{ ...type.headline, color: c.text, flex: 1 }}>Keep lookalikes apart</Text>
            <Switch value={look.keepApart} onValueChange={(v) => set({ keepLookalikesApart: v })} disabled={!settings} trackColor={{ true: c.accent }} accessibilityLabel="Keep lookalikes apart" />
          </View>
          <Help>
            After you see a word, cards for words that look like it (esperar, espero, esperanza) wait, so one doesn't give
            away the answer to the next. New cards and reviews wait; cards you're still learning don't.
          </Help>
          {look.keepApart ? (
            <View style={{ gap: space.s, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.m }}>
              <Text style={{ ...type.body, color: c.text }}>Wait at least</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {LOOKALIKE_DAY_CHOICES.map((d) => (
                  <Chip key={d} label={d === 1 ? 'Until tomorrow' : `${d} days`} selected={look.days === d} onPress={() => set({ lookalikeDays: d })} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, borderTopWidth: 1, borderTopColor: c.border, paddingTop: space.m }}>
            <Text style={{ ...type.body, color: c.text, flex: 1 }}>Offer to show a card again sooner</Text>
            <Switch value={look.offerSooner} onValueChange={(v) => set({ offerSooner: v })} disabled={!settings} trackColor={{ true: c.accent }} accessibilityLabel="Offer to show a card again sooner" />
          </View>
          <Help>
            When you saw a lookalike recently anyway, the answer side offers to bring the card back sooner. Anki may change
            the date later, when it recalculates its own schedule.
          </Help>
        </Card>
        <Help>Forms practice and lookalike settings apply to this deck and its subdecks, unless a subdeck sets its own.</Help>
      </ScrollView>
    </Screen>
  );
}
