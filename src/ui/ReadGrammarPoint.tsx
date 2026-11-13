import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { PracticeRecord } from '../core/forms';
import { explanationParagraphs, grammarPoint } from '../core/grammar';
import { knowItReason, pointPractice, POINT_PRACTICE_DAYS, practiceSince, suggestKnowIt } from '../core/grammarPage';
import type { GrammarAnswer } from '../core/grammarDrills';
import type { Note } from '../core/types';
import { ApiError, type Api, type GrammarChoice, type GrammarPointPage } from '../reader/api';
import { DEFAULT_MAX_PRACTICE, grammarChoiceOptions, grammarStateWord, markedParts, seenLine } from '../reader/grammar';
import { haptic } from './haptics';
import { Button, Card, ErrorNote, HeaderAction, Help, Screen, SectionTitle, Segments, Tappable } from './kit';
import { radius, space, type, useTheme } from './theme';

/**
 * A grammar point's page (docs/grammar.md, step 4): its choice, the explanation and related points
 * from the bundled catalog, the lines using it in texts read (from Read & Listen's server), and how
 * Forms practice has gone on its forms (on the phone), with a suggestion to mark it Know it when
 * that has gone well. Only a suggestion: nothing changes until the owner taps. The phone's data
 * comes through `practice` rather than the repo, which Read & Listen's code never imports
 * (tests/reader/noGrading.test.ts): it only reads, and keeps when Not yet was chosen.
 */
export function ReadGrammarPoint({ api, practice: phone, id, dayStartsAtHour, practiceDeck, onOpenPoint, onPracticeForms, onDrill }: {
  api: Api;
  practice: {
    load: () => Promise<{ notes: Note[]; practice: PracticeRecord[]; dismissed: Record<string, string>; drills: GrammarAnswer[] }>;
    saveDismissed: (dismissed: Record<string, string>) => Promise<void>;
  };
  id: string;
  dayStartsAtHour: number;
  /** The language's deck, for practicing the point's forms; null when Read & Listen hasn't said. */
  practiceDeck: string | null;
  onOpenPoint: (id: string) => void;
  onPracticeForms: (deck: string, groups: string[]) => void;
  /** Opens a grammar drill on this point (the Practice tab's Grammar tool). */
  onDrill: (id: string) => void;
}) {
  const c = useTheme();
  const point = grammarPoint(id);
  const [page, setPage] = useState<GrammarPointPage | null>(null);
  const [local, setLocal] = useState<{ notes: Note[]; practice: PracticeRecord[]; dismissed: Record<string, string>; drills: GrammarAnswer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const choosing = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPage(await api.grammarPoint(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this grammar point.");
    }
  }, [api, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { phone.load().then(setLocal); }, [phone]);

  const choose = async (state: GrammarChoice) => {
    if (!page || choosing.current || page.state === state) return;
    choosing.current = true;
    const before = page;
    setChoiceError(null);
    setPage({ ...page, state, choices: { ...page.choices, [id]: state } });
    try {
      await api.setGrammar(id, state);
    } catch (e) {
      setPage(before);
      setChoiceError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    } finally {
      choosing.current = false;
    }
  };

  const notYet = async () => {
    if (!local) return;
    const dismissed = { ...local.dismissed, [id]: new Date().toISOString() };
    await phone.saveDismissed(dismissed);
    setLocal({ ...local, dismissed });
  };

  if (!point) {
    return (
      <Screen title="Grammar">
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l }}>
          <Help>This grammar point isn't in this version of the app. Update the app to see it.</Help>
        </ScrollView>
      </Screen>
    );
  }

  const now = new Date();
  const results = local && point.forms.length ? pointPractice(id, local.notes, local.practice, practiceSince(now, dayStartsAtHour)) : null;
  const suggestion = page && local
    ? suggestKnowIt({ state: page.state, pointId: id, notes: local.notes, practice: local.practice, now, dayStartsAtHour, dismissedAt: local.dismissed[id], drillAnswers: local.drills })
    : undefined;
  const seen = page ? seenLine(page.seen, page.state, now, dayStartsAtHour) : null;
  const maxPractice = page?.max_practice ?? DEFAULT_MAX_PRACTICE;
  const practicingCount = Object.values(page?.choices ?? {}).filter((s) => s === 'practice').length;
  const related = point.related.map((r) => grammarPoint(r)).filter((r) => r !== undefined);

  return (
    <Screen title={point.name}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xl, gap: space.l }}>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{point.note}</Text>
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {!page && !error ? <ActivityIndicator color={c.accent} /> : null}
        {page ? (
          <View style={{ gap: space.s }}>
            {/* A point not set yet has no segment selected. */}
            <Segments<GrammarChoice | 'unset'>
              options={grammarChoiceOptions(point.name, page.state, practicingCount, maxPractice)}
              value={page.state}
              onChange={(state) => { if (state !== 'unset') choose(state); }}
            />
            <Help>
              {page.state !== 'practice' && practicingCount >= maxPractice
                ? `You're already practicing ${maxPractice} points. Set one to Know it on the Grammar screen to practice this one. Applies from the next text written.`
                : 'Applies from the next text written.'}
            </Help>
            {choiceError ? <ErrorNote message={choiceError} /> : null}
            <Button label="Drill this point" variant="secondary" onPress={() => onDrill(id)} />
          </View>
        ) : null}

        {suggestion && page ? (
          <View style={{ backgroundColor: c.accentFill, borderRadius: radius.l, padding: space.l, gap: space.s }}>
            <Text style={{ ...type.headline, color: c.text }}>Set it to Know it?</Text>
            <Text style={{ ...type.subhead, color: c.text }}>{knowItReason(suggestion, page.seen.texts)}</Text>
            <View style={{ flexDirection: 'row', gap: space.m }}>
              <HeaderAction label="Know it" accessibilityLabel={`Set ${point.name} to Know it`} onPress={() => { haptic.tap(); choose('normal'); }} />
              <HeaderAction label="Not yet" accessibilityLabel={`Not yet: keep ${point.name} as it is`} onPress={notYet} />
            </View>
          </View>
        ) : null}

        <View style={{ gap: space.s }}>
          <SectionTitle>About it</SectionTitle>
          <Card style={{ gap: space.m }}>
            {explanationParagraphs(point.explanation).map((para, i) => (
              <Text key={i} style={{ ...type.body, color: c.text, lineHeight: 24 }}>
                {para.map((run, j) => (run.language
                  ? <Text key={j} style={{ fontWeight: '600', color: c.accent }}>{run.text}</Text>
                  : run.text))}
              </Text>
            ))}
          </Card>
        </View>

        {related.length ? (
          <View style={{ gap: space.s }}>
            <SectionTitle>Compare with</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {related.map((r) => {
                const state = page?.choices[r.id];
                return (
                  <Tappable
                    key={r.id}
                    onPress={() => { haptic.tap(); onOpenPoint(r.id); }}
                    accessibilityRole="button"
                    accessibilityLabel={state ? `${r.name}, ${grammarStateWord(state)}` : r.name}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, backgroundColor: c.accentFill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.s }}
                  >
                    <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{r.name}</Text>
                    {state ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{`· ${grammarStateWord(state)}`}</Text> : null}
                  </Tappable>
                );
              })}
            </View>
          </View>
        ) : null}

        {page ? (
          <View style={{ gap: space.s }}>
            <SectionTitle>In your texts</SectionTitle>
            <Card style={{ gap: space.m }}>
              {seen ? <Text style={{ ...type.subhead, color: c.textSecondary }}>{seen}</Text> : null}
              {page.examples.map((e, i) => (
                <View key={`${e.text_id}:${i}`} style={{ gap: 2, paddingTop: space.m, borderTopWidth: 1, borderTopColor: c.border }}>
                  <Text style={{ ...type.callout, color: c.text }}>
                    {markedParts(e.line, e.words).map((part, j) => (part.marked
                      ? <Text key={j} style={{ textDecorationLine: 'underline', textDecorationColor: c.accent }}>{part.text}</Text>
                      : part.text))}
                  </Text>
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{`${e.title} · ${e.english}`}</Text>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        {results ? (
          <View style={{ gap: space.s }}>
            <SectionTitle>In Forms practice</SectionTitle>
            <Card style={{ gap: space.m }}>
              {results.answers ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.s }}>
                    <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{`${results.right} of ${results.answers}`}</Text>
                    <Text style={{ ...type.subhead, color: c.textSecondary }}>{`right in the last ${POINT_PRACTICE_DAYS} days`}</Text>
                  </View>
                  {results.missed.length ? (
                    <View style={{ gap: space.xs }}>
                      <Text style={{ ...type.subhead, color: c.textSecondary }}>Missed most:</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                        {results.missed.map((m) => (
                          <View key={m} style={{ backgroundColor: c.fill, borderRadius: radius.pill, paddingHorizontal: space.m, paddingVertical: space.xs }}>
                            <Text style={{ ...type.footnote, color: c.text }}>{m}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </>
              ) : (
                <Help>{`No Forms practice on these forms in the last ${POINT_PRACTICE_DAYS} days.`}</Help>
              )}
              {practiceDeck ? (
                <Button
                  label={`Practice ${point.forms.join(' and ')} forms`}
                  variant="secondary"
                  onPress={() => onPracticeForms(practiceDeck, point.forms)}
                />
              ) : null}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
