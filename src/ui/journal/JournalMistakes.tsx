import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { compareTyped } from '../../core/typedCompare';
import type { Api, JournalKind, Language } from '../../reader/api';
import { kindPractice } from '../../reader/journal';
import { LANGUAGES } from '../../reader/languages';
import { CASE_LANGUAGES } from '../../tools/cases';
import { Button, Card, ErrorNote, Help, Loading, Screen, Segments } from '../kit';
import { readable, space, type, useTheme } from '../theme';
import { TypedDiff } from '../TypedDiff';

const CASE_LANGUAGE_LIST = Object.keys(CASE_LANGUAGES) as Language[];

/**
 * What you keep getting wrong (src/reader/journal.ts): each kind of mistake the journal's first checks found,
 * the most frequent first, with its latest example and its practice. A case ending offers Which case, where it
 * already counts as a miss; a grammar point offers its page and Use it in texts, which sets it to Practice for
 * Read & Listen and Sentences. Nothing here grades a card.
 */
export function JournalMistakes({ api, language }: { api: Api; language: Language }) {
  const c = useTheme();
  const router = useRouter();
  const [days, setDays] = useState<60 | 0>(60);
  const [kinds, setKinds] = useState<JournalKind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [practicing, setPracticing] = useState<Record<string, 'busy' | 'done' | string>>({});
  const asking = useRef(0);
  const lang = LANGUAGES[language].speech;

  const load = useCallback(async () => {
    const mine = ++asking.current;
    setError(null);
    setKinds(null);
    try {
      const got = await api.journal(language, days);
      if (asking.current === mine) setKinds(got.kinds);
    } catch (e) {
      if (asking.current === mine) setError(failureText(e, { what: "Couldn't read your mistakes.", next: 'Try again.' }));
    }
  }, [api, language, days]);
  useEffect(() => { void load(); }, [load]);

  const useInTexts = async (point: string) => {
    setPracticing((p) => ({ ...p, [point]: 'busy' }));
    try {
      await api.setGrammar(point, 'practice');
      setPracticing((p) => ({ ...p, [point]: 'done' }));
    } catch (e) {
      setPracticing((p) => ({ ...p, [point]: failureText(e, { what: "Couldn't set it to Practice.", next: 'Try again.' }) }));
    }
  };

  return (
    <Screen title="Mistakes" largeTitle={false}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: space.xl, gap: space.m }}>
        <Segments options={[{ value: 60, label: '60 days' }, { value: 0, label: 'All time' }]} value={days} onChange={setDays} />
        {error ? <ErrorNote message={error} onRetry={() => void load()} /> : !kinds ? <Loading /> : !kinds.length ? (
          <Help>{days ? 'No mistakes in your journal in the last 60 days.' : 'No mistakes in your journal yet.'}</Help>
        ) : kinds.map((k) => {
          const practice = kindPractice(k, CASE_LANGUAGE_LIST, language);
          const state = k.point ? practicing[k.point] : undefined;
          return (
            <Card key={k.group} style={{ gap: space.s }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.m }}>
                <Text style={{ ...type.headline, color: c.text, flex: 1 }}>{k.name}</Text>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>{k.count === 1 ? 'Once' : `${k.count} times`}</Text>
              </View>
              {k.written && k.corrected !== k.written ? (
                <TypedDiff comparison={compareTyped(k.corrected, k.written)} showExpected size="body" lang={lang} expectedLabel="Corrected" showLine={false} />
              ) : null}
              {practice === 'cases' ? (
                <>
                  <Help>Counted as a miss in Which case, so this case comes up more there and in Today's extras.</Help>
                  <Button label="Practice in Which case" variant="secondary" onPress={() => router.push({ pathname: '/tool', params: { id: 'cases' } })} />
                </>
              ) : practice === 'point' && k.point ? (
                <>
                  <View style={{ flexDirection: 'row', gap: space.s }}>
                    <Button label="Read about it" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/read-grammar-point', params: { id: k.point! } })} />
                    <Button label={state === 'done' ? 'Practicing' : 'Use it in texts'} variant="secondary" style={{ flex: 1 }} busy={state === 'busy'} disabled={state === 'done'} onPress={() => void useInTexts(k.point!)} />
                  </View>
                  {state && state !== 'busy' && state !== 'done' ? <ErrorNote message={state} /> : null}
                </>
              ) : null}
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
