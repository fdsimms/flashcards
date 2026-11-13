import React, { useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { ApiError, type Language } from '../reader/api';
import { MAX_WORDS, parseWords } from '../reader/noteQueue';
import { Button, Card, ErrorNote, Field, Help, Screen, Select } from './kit';
import { space } from './theme';

/**
 * Quick add: type or paste words, one per line, and Claude fills in the rest on the server (Read &
 * Listen, src/reader/noteQueue.ts). Nothing is added to the deck here: each filled-in note waits to be
 * reviewed in the note editor, where saving is the approval (CLAUDE.md, Read & Listen).
 */
export function ReadQuickAdd({ decks, initial, onAdd, onDone }: {
  /** The decks that hold a Read & Listen language, and which language each one is. */
  decks: { deck: string; language: Language }[];
  /** The deck chosen to begin with. */
  initial: string;
  onAdd: (language: Language, deck: string, entries: { entry: string; meaning: string }[]) => Promise<void>;
  onDone: () => void;
}) {
  const [deck, setDeck] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { entries, repeated } = useMemo(() => parseWords(text), [text]);
  const tooMany = entries.length > MAX_WORDS;

  const add = async () => {
    const language = decks.find((d) => d.deck === deck)?.language;
    // A second tap while the request is out would queue every word twice.
    if (busy || !language || !entries.length || tooMany) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(language, deck, entries);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't add these words. Try again.");
      setBusy(false);
    }
  };

  return (
    <Screen
      title="Quick add"
      largeTitle={false}
      footer={<Button label={entries.length ? `Add ${entries.length} to queue` : 'Add to queue'} onPress={add} busy={busy} disabled={!entries.length || tooMany} />}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Card>
          <Select label="Deck" options={decks.map((d) => d.deck)} value={deck} onChange={setDeck} />
        </Card>
        <Card>
          <Field
            label="Words"
            value={text}
            onChangeText={(t) => { setText(t); setError(null); }}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
          />
        </Card>
        {tooMany ? <ErrorNote message={`That's ${entries.length} words. Add up to ${MAX_WORDS} at a time.`} /> : null}
        {error ? <ErrorNote message={error} onRetry={add} /> : null}
        <Help>
          One word or phrase per line. To use your own meaning, add it after a dash: bouder - to sulk. Claude fills in everything else.
          You review each note before it's added to the deck.
          {repeated ? ` ${repeated === 1 ? '1 repeated line was' : `${repeated} repeated lines were`} ignored.` : ''}
        </Help>
      </ScrollView>
    </Screen>
  );
}
