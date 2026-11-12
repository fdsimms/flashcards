import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import type { Api, ExplainPoint } from '../reader/api';
import { Tappable, ErrorNote } from './kit';
import { haptic } from './haptics';
import { radius, space, type, useTheme } from './theme';

/**
 * A line's explanation, opened under it by the reader's explain button. It asks the server when it
 * mounts (the server writes it once and keeps it, so opening a line again costs nothing), and
 * "Explain more simply" asks for the plainer version. Nothing here grades a word or touches a card.
 */
export function LineExplanation({ api, textId, line }: { api: Api; textId: number; line: number }) {
  const c = useTheme();
  const [simple, setSimple] = useState(false);
  const [points, setPoints] = useState<ExplainPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Counts requests, so an answer that arrives after a newer one was asked for (or after closing) is dropped.
  const latest = useRef(0);

  const load = async (wantSimple: boolean) => {
    const mine = ++latest.current;
    setError(null);
    setPoints(null);
    try {
      const answer = await api.explainLine(textId, line, wantSimple);
      if (latest.current === mine) { setPoints(answer); setSimple(wantSimple); }
    } catch (e) {
      if (latest.current === mine) { setError(e instanceof Error ? e.message : String(e)); setSimple(wantSimple); }
    }
  };

  useEffect(() => {
    load(false);
    return () => { latest.current++; };
    // Asked once when the line's explanation opens.
  }, []);

  return (
    <View
      accessibilityLabel={`Explanation of line ${line + 1}`}
      style={{ marginTop: space.s, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: radius.m, padding: space.m, gap: space.s }}
    >
      {error ? (
        <ErrorNote message={error} onRetry={() => load(simple)} />
      ) : points === null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <ActivityIndicator />
          <Text style={{ ...type.subhead, color: c.textSecondary }}>Asking Claude…</Text>
        </View>
      ) : (
        <>
          {points.map((p, i) => (
            <Text key={i} style={{ ...type.subhead, color: c.text }}>
              <Text style={{ fontWeight: '700', color: c.accent }}>{p.phrase}</Text>
              {`: ${p.note}`}
            </Text>
          ))}
          {simple ? null : (
            <Tappable
              onPress={() => { haptic.tap(); load(true); }}
              accessibilityRole="button"
              accessibilityLabel="Explain more simply"
              style={{ alignSelf: 'flex-start', backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s }}
            >
              <Text style={{ ...type.footnote, color: c.text }}>Explain more simply</Text>
            </Tappable>
          )}
        </>
      )}
    </View>
  );
}
