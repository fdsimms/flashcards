import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { ApiError, type Api, type AudioLesson, type Language } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { anyMaking, lessonDetail, POLL_MS, type Particle } from '../../reader/lessons';
import { Button, Card, ErrorNote, Field, Group, Help, NavRow, Screen } from '../kit';
import { LessonMakingRow } from './LessonMakingRow';
import { useConnectionProblem } from '../connection';
import { useLessonDownloads } from './useLessonDownloads';
import { space, useTheme, readable } from '../theme';

/**
 * Audio lessons (docs/read-and-listen/architecture.md, Audio lessons): a scene typed in, a guided
 * lesson the server writes and speaks in the background, and the lessons made so far. A lesson
 * being made is asked about every few seconds until it's ready or failed. Opening one plays it
 * (ReadLesson.tsx). Nothing here grades a card or writes a note.
 */
export function ReadLessons({ api, language, toolbar, narrator, particle, onOpen }: {
  api: Api;
  language: Language;
  /** The header's language menu. */
  toolbar?: React.ReactNode;
  /** The English voice chosen to narrate, or '' for the server's own (chosen in Settings, Lessons). */
  narrator: string;
  /** A Thai lesson's polite ending, which also decides the voice you repeat after (chosen in Settings, Lessons). */
  particle: Particle;
  onOpen: (lesson: AudioLesson) => void;
}) {
  const c = useTheme();
  const [lessons, setLessons] = useState<AudioLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scene, setScene] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const downloadButton = useLessonDownloads(api);
  const problem = useConnectionProblem();

  const load = useCallback(async () => {
    try {
      setLessons((await api.lessons(language)).lessons);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your lessons.");
    }
  }, [api, language]);
  useEffect(() => { load(); }, [load]);

  // Checked again while one is being made, and not otherwise.
  const making = lessons !== null && anyMaking(lessons);
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [making, load]);

  const make = async () => {
    const text = scene.trim();
    if (!text || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      await api.makeLesson(language, text, narrator || undefined, language === 'th' ? particle : undefined);
      setScene('');
      await load();
    } catch (e) {
      setAskError(e instanceof ApiError ? e.message : "Couldn't ask for the lesson. Try again.");
    } finally {
      setAsking(false);
    }
  };

  const remove = async (lesson: AudioLesson) => {
    try {
      await api.deleteLesson(lesson.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete the lesson. Try again.");
    }
  };

  // A lesson that failed has nothing to play, so tapping it offers to delete it.
  const confirmDelete = (lesson: AudioLesson) => {
    Alert.alert('Delete this lesson?', `"${lesson.title}" didn't finish, so there's nothing to play.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(lesson) },
    ]);
  };

  return (
    <Screen title="Audio lessons" toolbar={toolbar}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        <Card>
          <Field
            label="New lesson"
            value={scene}
            onChangeText={setScene}
            placeholder="Ordering a coffee"
            maxLength={200}
            returnKeyType="done"
            onSubmitEditing={make}
          />
          <Button label="Make a lesson" onPress={make} busy={asking} disabled={!scene.trim()} />
          {askError ? <ErrorNote message={askError} /> : null}
        </Card>
        <Help>
          Claude writes about five {LANGUAGES[language].name} phrases to teach in that scene, and a voice records the lesson with spaces
          for you to answer in. It takes about a minute, and the spoken parts cost a few cents.
        </Help>
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {lessons === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {problem ? <Help>{problem === 'offline' ? "Offline, only lessons on this iPhone are listed." : "Your server isn't answering, so only lessons on this iPhone are listed."}</Help> : null}
        {lessons !== null && lessons.length === 0 && !problem ? <Help>No lessons yet. Type a scene above to make your first.</Help> : null}
        {lessons !== null && lessons.length > 0 ? (
          <Group>
            {lessons.map((l, i) => (
              <View key={l.id}>
                {l.state === 'making' ? (
                  <LessonMakingRow lesson={l} first={i === 0} />
                ) : (
                  <NavRow
                    first={i === 0}
                    label={l.title}
                    detail={lessonDetail(l)}
                    onPress={() => (l.state === 'ready' ? onOpen(l) : confirmDelete(l))}
                    action={l.state === 'failed' ? { icon: 'trash', label: `Delete ${l.title}`, onPress: () => confirmDelete(l) } : l.state === 'ready' ? downloadButton(l) : undefined}
                  />
                )}
              </View>
            ))}
          </Group>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
