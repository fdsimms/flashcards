import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { ApiError, type Api, type GrammarPoint, type GrammarState } from '../reader/api';
import { Card, ErrorNote, Help, Screen, Segments } from './kit';
import { space, type, useTheme } from './theme';

/**
 * The current language's grammar points, each practiced (used at least twice in every text), known
 * (allowed, not asked for) or not known (kept out). The stored states are still practice, normal
 * and avoid. The server checks each text for them and sends back a draft that misses
 * (docs/read-and-listen/architecture.md, Grammar).
 */

const STATES: { value: GrammarState; label: string }[] = [
  { value: 'practice', label: 'Practice' },
  { value: 'normal', label: 'Know it' },
  { value: 'avoid', label: "Don't know it" },
];

export function ReadGrammar({ api }: { api: Api }) {
  const c = useTheme();
  const [points, setPoints] = useState<GrammarPoint[] | null>(null);
  const [maxPractice, setMaxPractice] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api.grammar();
      setPoints(body.points);
      setMaxPractice(body.max_practice);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the grammar list.");
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const choose = async (id: string, state: GrammarState) => {
    const before = points;
    setPoints((ps) => ps?.map((p) => (p.id === id ? { ...p, state } : p)) ?? ps);
    setError(null);
    try {
      setPoints((await api.setGrammar(id, state)).points);
    } catch (e) {
      setPoints(before);
      setError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    }
  };

  return (
    <Screen title="Grammar">
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
        <Help>
          {`Practice: used at least twice in every text, at most ${maxPractice} at a time. Know it: can appear in a text, but isn't asked for. Don't know it: kept out of texts until you've learned it. Applies from the next text written.`}
        </Help>
        {error ? <ErrorNote message={error} onRetry={points === null ? load : undefined} /> : null}
        {points === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {points && points.length === 0 ? <Help>There are no grammar points for this language yet.</Help> : null}
        {points && points.length > 0 ? (
          <Card style={{ paddingVertical: 0, gap: 0 }}>
            {points.map((p, i) => (
              <View key={p.id} style={{ paddingVertical: space.m, gap: space.xs, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                <Text style={{ ...type.headline, color: c.text }}>{p.name}</Text>
                <Text style={{ ...type.subhead, color: c.textSecondary }}>{p.note}</Text>
                <Segments<GrammarState>
                  style={{ marginTop: space.s }}
                  options={STATES.map((s) => ({ ...s, accessibilityLabel: `${p.name}: ${s.label}` }))}
                  value={p.state}
                  onChange={(state) => choose(p.id, state)}
                />
              </View>
            ))}
          </Card>
        ) : null}
        <Help>The server checks each text for these and rewrites one that misses, so most texts follow them.</Help>
      </ScrollView>
    </Screen>
  );
}
