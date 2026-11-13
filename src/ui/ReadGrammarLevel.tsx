import React, { useState } from 'react';
import { Text } from 'react-native';
import { ApiError, type Api, type GrammarList, type GrammarPoint } from '../reader/api';
import { jlptLevels, jlptName, knownThroughLevel } from '../reader/grammar';
import { Card, ErrorNote, Segments } from './kit';
import { space, type, useTheme } from './theme';

/**
 * "I know grammar through N_": one tap sets every point of a language with JLPT levels (Japanese)
 * by its level, the server doing it in one write (`PUT /api/grammar/level`). Nothing is stored but
 * each point's own choice, so the selected level is whichever one the points' choices match, and
 * none once a point is changed by hand. Not shown for a language without levels.
 */
export function ReadGrammarLevel({ api, points, onList }: { api: Api; points: GrammarPoint[]; onList: (list: GrammarList) => void }) {
  const c = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const levels = jlptLevels(points);
  if (levels.length === 0) return null;

  const pick = async (through: number) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onList(await api.setGrammarLevel(through));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't set the level. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: space.s }}>
      <Text style={{ ...type.headline, color: c.text }}>I know grammar through</Text>
      {/* No level selected (0) when the points' choices match none. */}
      <Segments<number>
        options={levels.map((n) => ({ value: n, label: jlptName(n), accessibilityLabel: `I know grammar through ${jlptName(n)}`, disabled: busy }))}
        value={knownThroughLevel(points) ?? 0}
        onChange={pick}
      />
      <Text style={{ ...type.subhead, color: c.textSecondary }}>
        Points at that JLPT level or easier are set to Know it, unless you practice them. Harder points are set to Don't know it. You can still change any point below.
      </Text>
      {error ? <ErrorNote message={error} /> : null}
    </Card>
  );
}
