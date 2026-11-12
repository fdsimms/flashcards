import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type MarkedWord } from '../reader/api';
import { wordStatus } from '../reader/languages';
import { Button, Card, ErrorNote, Help, Screen } from './kit';
import { space, type, useTheme } from './theme';

/**
 * Every word marked unknown while reading, newest first, with its meaning, so they can be looked at
 * together. Nothing here writes to Anki (CLAUDE.md, Read & Listen). Clear takes a word off the list
 * until it's marked again.
 */
export function ReadWords({ api }: { api: Api }) {
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
                  <Button label="Clear" variant="secondary" onPress={() => clear(w.word)} />
                </View>
              ))}
            </Card>
            <Help>Only saved here. Nothing is added to Anki. Clear a word once you've dealt with it.</Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
