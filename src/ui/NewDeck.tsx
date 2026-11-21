import { Stack, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { createDeck, DeckRefused } from '../anki/deckService';
import { refreshFromKeptCollection } from '../anki/transfer';
import { NOTE_LANGUAGES, noteLanguageOfDeck } from '../core/cards';
import { failureText } from '../core/failure';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Button, Card, Field, Help, Screen, Select, SwitchRow } from './kit';
import { backToDecks } from './leaveScreen';
import { readable, space, type, useTheme } from './theme';

const NO_LANGUAGE = 'No language';

/**
 * New deck, as a sheet from the deck list's menu and the first-run card: its name, the language its
 * notes are in (read from the name until another is picked; No language for facts, such as trivia),
 * and whether each word also asks its meaning, to answer in the language. The language and the switch
 * are kept in Deck options (`DeckSettings.noteLanguage`, `askBothWays`) and decide how a note added to
 * it starts (`startNoteFor`).
 */
export function NewDeck() {
  const c = useTheme();
  const router = useRouter();
  const { repo, refresh } = useApp();
  const [name, setName] = useState('');
  // Undefined follows the name; a pick (No language included) stays.
  const [picked, setPicked] = useState<string>();
  const [bothWays, setBothWays] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const language = picked ?? noteLanguageOfDeck(name) ?? '';

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const deck = await createDeck(repo, name, () => refreshFromKeptCollection(repo));
      const settings = (await repo.listDeckSettings()).get(deck) ?? {};
      await repo.saveDeckSettings(deck, { ...settings, noteLanguage: language, askBothWays: !!language && bothWays });
      haptic.success();
      await refresh();
      backToDecks(router);
    } catch (e) {
      setProblem(e instanceof DeckRefused ? e.message : failureText(e, { what: "Couldn't create the deck.", next: 'Try again.' }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="New deck"
      largeTitle={false}
      toolbar={(
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button accessibilityLabel="Cancel" onPress={() => backToDecks(router)}>Cancel</Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
      footer={(
        <>
          {problem ? <Text style={{ ...type.subhead, color: c.danger }}>{problem}</Text> : null}
          <Button label="Make deck" onPress={() => void make()} busy={busy} disabled={!name.trim()} />
        </>
      )}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...readable, padding: space.l, gap: space.l }}>
        <Card>
          <Field label="Name" value={name} onChangeText={(v) => { setName(v); setProblem(undefined); }} placeholder="e.g. Spanish" autoFocus returnKeyType="done" error={!!problem} />
          <Help>To put it inside another deck, use "::", e.g. Spanish::Verbs.</Help>
        </Card>
        <Card>
          <Select
            label="Language"
            options={[...NOTE_LANGUAGES.map((l) => l.name), NO_LANGUAGE]}
            value={language || NO_LANGUAGE}
            onChange={(v) => setPicked(v === NO_LANGUAGE ? '' : v)}
          />
          {language ? (
            <SwitchRow label={`Also ask English to ${language}`} value={bothWays} onValueChange={setBothWays} />
          ) : null}
          <Help>
            {language
              ? `Each word is read aloud in ${language} and shows in Practice.${bothWays ? ` Each word also makes a second card: the meaning, to answer in ${language}.` : ''}`
              : 'Choose No language for a deck of facts, such as capitals or trivia: nothing is read aloud.'}
          </Help>
        </Card>
      </ScrollView>
    </Screen>
  );
}
