import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type MarkedWord } from '../reader/api';
import { wordStatus } from '../reader/languages';
import { Button, Card, ErrorNote, Help, Screen } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Every word marked unknown while reading, newest first, with its meaning, so they can be looked at
 * together. Clear takes a word off the list until it's marked again. Add to deck opens Franki's
 * note editor with the word filled in (the read-words route opens it): nothing reaches the deck
 * unless it's saved there. A word
 * saved there is cleared from the list. This screen writes nothing to the deck itself (CLAUDE.md,
 * Read & Listen).
 */
export function ReadWords({ api, mining }: {
  api: Api;
  /**
   * Present when words can be added to the deck: its name, how many more today, and what opens the
   * editor, resolving true once the note is saved.
   */
  mining?: { deck: string; onAdd: (word: MarkedWord) => Promise<boolean> };
}) {
  const c = useTheme();
  const [words, setWords] = useState<MarkedWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setWords(await api.markedWords());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your marked words.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const clear = async (word: string) => {
    const before = words;
    setWords((ws) => ws?.filter((w) => w.word !== word) ?? ws);
    try {
      await api.clearWord(word);
    } catch (e) {
      setWords(before);
      setError(e instanceof ApiError ? e.message : "Couldn't clear that word. Try again.");
    }
  };

  // Off the list once it's in the deck, as Clear does.
  const add = async (word: MarkedWord) => {
    if (mining && await mining.onAdd(word)) await clear(word.word);
  };

  return (
    <Screen title="Marked words">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {words === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {words !== null && words.length === 0 ? <Help>No marked words. While reading, tap a word and choose Mark as unknown.</Help> : null}
        {words !== null && words.length > 0 ? (
          <>
            <Card style={{ paddingVertical: 0, gap: 0 }}>
              {words.map((w, i) => (
                <View key={w.word} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.m, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ ...type.title, fontWeight: '400', color: c.text }}>{w.word}</Text>
                    {w.lemma ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Dictionary form: {w.lemma}</Text> : null}
                    <Text style={{ ...type.body, color: c.text }}>{w.gloss ?? 'No meaning available'}</Text>
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>
                      {wordStatus(w)}{w.times > 1 ? `. Marked ${w.times} times.` : ''}
                    </Text>
                  </View>
                  <View style={{ gap: space.s }}>
                    {mining && !w.deck ? (
                      <Button label="Add to deck" onPress={() => add(w)} />
                    ) : null}
                    <Button label="Clear" variant="secondary" onPress={() => clear(w.word)} />
                  </View>
                </View>
              ))}
            </Card>
            {mining ? <Help>{`Add to deck opens a new note in ${mining.deck} with the word and its meaning, to check before saving.`}</Help> : null}
            <Help>Clear a word once you've dealt with it. Adding one to the deck clears it too.</Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
