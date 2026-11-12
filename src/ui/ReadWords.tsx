import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type MarkedWord } from '../reader/api';
import { wordStatus } from '../reader/languages';
import { MINING_PER_DAY } from '../reader/mining';
import { Button, Card, ErrorNote, Help, Screen } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Every word marked unknown while reading, newest first, with its meaning, so they can be looked at
 * together. Clear takes a word off the list until it's marked again. Add to deck opens Franki's
 * note editor with the word filled in (the read-words route does): nothing reaches the deck unless it's saved there,
 * and at most MINING_PER_DAY a study day (src/reader/mining.ts). This screen writes nothing itself
 * (CLAUDE.md, Read & Listen).
 */
export function ReadWords({ api, mining }: {
  api: Api;
  /** Present when words can be added to the deck: its name, how many more today, and what opens the editor. */
  mining?: { deck: string; left: number; onAdd: (word: MarkedWord) => void };
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
                    <Text style={{ ...type.body, color: c.text }}>{w.gloss ?? 'No meaning available'}</Text>
                    <Text style={{ ...type.footnote, color: c.textSecondary }}>
                      {wordStatus(w)}{w.times > 1 ? `. Marked ${w.times} times.` : ''}
                    </Text>
                  </View>
                  <View style={{ gap: space.s }}>
                    {mining && !w.deck ? (
                      <Button label="Add to deck" onPress={() => mining.onAdd(w)} disabled={mining.left === 0} />
                    ) : null}
                    <Button label="Clear" variant="secondary" onPress={() => clear(w.word)} />
                  </View>
                </View>
              ))}
            </Card>
            {mining ? (
              <Help>
                {mining.left === 0
                  ? `You've added ${MINING_PER_DAY} words today, the most for one day, so your reviews stay manageable. Add more tomorrow.`
                  : `Add to deck opens a new note in ${mining.deck} with the word and its meaning, to check before saving. Up to ${MINING_PER_DAY} a day; ${mining.left} left today.`}
              </Help>
            ) : null}
            <Help>Clear a word once you've dealt with it. Adding one to the deck clears it too.</Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
