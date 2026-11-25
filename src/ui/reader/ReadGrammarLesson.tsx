import { useAudioPlayer } from 'expo-audio';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { failureText } from '../../core/failure';
import { grammarPoint } from '../../core/grammar';
import type { Api, GrammarLesson, GrammarLessonExample, Language } from '../../reader/api';
import { GrammarExamples } from '../GrammarExamples';
import { Button, ErrorNote, Help, Loading, Screen, SectionTitle, Card } from '../kit';
import { MakingCard } from '../MakingCard';
import { space, type, useTheme, readable } from '../theme';
import { useOutputWake } from '../useOutputWake';
import { useTrackedPlayer } from '../useSoundingButton';
import { GrammarExplanation, type ExplanationGlossing } from './GrammarExplanation';

/** How often a lesson being written is asked about again. */
const POLL_MS = 2500;

/**
 * A grammar point's lesson (docs/read-and-listen/architecture.md, Grammar, "Lesson"; the one-page
 * layout the owner picked from the mock, 25 November 2026): the catalog's explanation, example lines
 * written from the known words (each played in an Azure voice, the phone's when there's no
 * recording, with its English behind a tap), then the point's practice questions. Opened from the
 * shelf's rotation card and the point's page. Nothing here grades a card: the questions are the
 * drills'.
 */
export function ReadGrammarLesson({ api, id, glossing, onSay, onPractice }: {
  api: Api;
  id: string;
  /** What a tapped word in the explanation does: play it, add it to the deck. */
  glossing: Omit<ExplanationGlossing, 'api'>;
  /** Says a line in the phone's voice, for an example with no recording. */
  onSay: (line: string, language: Language) => void;
  /** Opens the point's practice questions. */
  onPractice: (id: string) => void;
}) {
  const c = useTheme();
  const point = grammarPoint(id);
  const [lesson, setLesson] = useState<GrammarLesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const player = useAudioPlayer(null);
  useTrackedPlayer(player);
  const wake = useOutputWake();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api.grammarLesson(id);
      if (alive.current) setLesson(next);
    } catch (e) {
      if (alive.current) setError(failureText(e, { what: "Couldn't load this lesson.", next: 'Try again.' }));
    }
  }, [api, id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (lesson?.status !== 'writing') return;
    const t = setTimeout(() => { void load(); }, POLL_MS);
    return () => clearTimeout(t);
  }, [lesson, load]);

  const rewrite = async () => {
    setRewriting(true);
    setError(null);
    try {
      setLesson(await api.rewriteGrammarLesson(id));
    } catch (e) {
      setError(failureText(e, { what: "Couldn't write this lesson.", next: 'Try again.' }));
    } finally {
      setRewriting(false);
    }
  };

  const play = async (ex: GrammarLessonExample) => {
    if (!point) return;
    if (!ex.audio) {
      onSay(ex.line, point.language);
      return;
    }
    // Bluetooth headphones that have been quiet lose the start of the next sound (useOutputWake).
    await wake();
    player.replace(api.situationAudio(ex.audio));
    player.play();
  };

  if (!point) {
    return (
      <Screen title="Lesson">
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l }}>
          <Help>This grammar point isn't in this version of the app. Update the app to see it.</Help>
        </ScrollView>
      </Screen>
    );
  }

  const ready = lesson && lesson.examples.length > 0;
  return (
    <Screen
      title={point.name}
      footer={ready ? <Button label="Practice 5 questions" onPress={() => onPractice(id)} /> : undefined}
    >
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, padding: space.l, gap: space.l }}>
        <Text style={{ ...type.subhead, color: c.textSecondary }}>{point.note}</Text>

        <View style={{ gap: space.s }}>
          <SectionTitle>About it</SectionTitle>
          <Card style={{ gap: space.m }}>
            <GrammarExplanation language={point.language} explanation={point.explanation} glossing={{ api, ...glossing }} />
          </Card>
        </View>

        <View style={{ gap: space.s }}>
          <SectionTitle>Examples</SectionTitle>
          {error ? <ErrorNote message={error} onRetry={load} /> : null}
          {!lesson && !error ? <Loading /> : null}
          {lesson?.status === 'writing' && !lesson.examples.length ? (
            <MakingCard title="Writing examples" detail="From words you know. This takes a few seconds." />
          ) : null}
          {lesson?.note ? <ErrorNote message={lesson.note} onRetry={rewriting ? undefined : () => { void rewrite(); }} /> : null}
          {ready ? (
            <GrammarExamples
              generation={0}
              examples={lesson.examples.map((ex) => ({ line: ex.line, english: ex.english, words: ex.words, onPlay: () => { void play(ex); } }))}
            />
          ) : null}
        </View>
      </ScrollView>
    </Screen>
  );
}
