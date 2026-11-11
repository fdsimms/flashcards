import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { ApiError, type Api, type PastText, type Rating } from '../reader/api';
import { Card, ErrorNote, Help, NavRow, Screen } from './kit';
import { space, useTheme } from './theme';

/**
 * Texts read to the end, newest first. Opening one reads it again in the reader, with nothing
 * logged (docs/read-and-listen/architecture.md, Client).
 */

const RATING_TEXT: Record<Rating, string> = { too_easy: 'Too easy', about_right: 'About right', too_hard: 'Too hard' };

/** "Oct 26", from the server's timestamp. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ReadPastTexts({ api, onOpen, onDone }: { api: Api; onOpen: (text: PastText) => void; onDone: () => void }) {
  const c = useTheme();
  const [texts, setTexts] = useState<PastText[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setTexts(await api.pastTexts());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your past texts.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  return (
    <Screen onBack={onDone} backLabel="Read & Listen" title="Past texts">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {texts === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {texts !== null && texts.length === 0 ? <Help>No past texts yet. Texts you finish show up here, to read or listen to again.</Help> : null}
        {texts !== null && texts.length > 0 ? (
          <>
            <Card style={{ paddingVertical: 0, gap: 0 }}>
              {texts.map((t, i) => (
                <NavRow
                  key={t.id}
                  first={i === 0}
                  label={t.title}
                  detail={[t.topic, t.form === 'story' ? 'Story' : null, shortDate(t.read_at), t.rating ? RATING_TEXT[t.rating] : null].filter(Boolean).join(' · ')}
                  onPress={() => onOpen(t)}
                />
              ))}
            </Card>
            <Help>Reading a text again isn't logged and doesn't change how hard new texts are.</Help>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
