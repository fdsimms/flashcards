import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View } from 'react-native';
import { ApiError, type Api, type AudioLesson, type Language } from '../../reader/api';
import { azureVoiceName } from '../../core/voices';
import { LANGUAGES } from '../../reader/languages';
import { anyMaking, lessonDetail, POLL_MS, type Particle } from '../../reader/lessons';
import { lessonRequestWords } from '../../core/lessonWords';
import { Button, Card, ErrorNote, Field, Group, Help, NavRow, Screen, Segments } from '../kit';
import { LessonMakingRow } from './LessonMakingRow';
import { LessonWords } from './LessonWords';
import { useLessonWords } from './useLessonWords';
import { useConnectionProblem } from '../connection';
import { useLessonDownloads } from './useLessonDownloads';
import { space, useTheme, readable } from '../theme';

/**
 * Audio lessons (docs/read-and-listen/architecture.md, Audio lessons): a scene typed in, a guided
 * lesson the server writes and speaks in the background, and the lessons made so far. A lesson
 * being made is asked about every few seconds until it's ready or failed. Opening one plays it
 * (ReadLesson.tsx). Nothing here grades a card or writes a note.
 */
export function ReadLessons({ api, language, toolbar, narrator, defaultNarrator, particle, onNarrator, onParticle, onOpen }: {
  api: Api;
  language: Language;
  /** The header's language menu. */
  toolbar?: React.ReactNode;
  /** The English voice chosen to narrate, or '' for the server's own. */
  narrator: string;
  /** The server's own English voice, named while none is chosen. */
  defaultNarrator: string | undefined;
  /** A Thai lesson's polite ending, which also decides the voice you repeat after. */
  particle: Particle;
  onNarrator: () => void;
  onParticle: (particle: Particle) => void;
  onOpen: (lesson: AudioLesson) => void;
}) {
  const c = useTheme();
  const [lessons, setLessons] = useState<AudioLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scene, setScene] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const chosen = useLessonWords(language);
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
      await api.makeLesson(language, text, narrator || undefined, language === 'th' ? particle : undefined, chosen.words.length ? lessonRequestWords(chosen.words) : undefined);
      setScene('');
      chosen.clear();
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
            placeholder={chosen.words.length ? "What they're for, like at a cafe" : "Ordering a coffee"}
            maxLength={200}
            returnKeyType="done"
            onSubmitEditing={make}
          />
          <LessonWords words={chosen.words} onRemove={chosen.remove} onClear={chosen.clear} />
          <Button label="Make a lesson" onPress={make} busy={asking} disabled={!scene.trim()} />
          {askError ? <ErrorNote message={askError} /> : null}
        </Card>
        <Help>
          {chosen.words.length
            ? `Claude writes the dialogue around your ${chosen.words.length === 1 ? 'word' : `${chosen.words.length} words`} and teaches every one of them, and a voice records the lesson with spaces for you to answer in.`
            : `Claude writes about five ${LANGUAGES[language].name} phrases to teach in that scene, and a voice records the lesson with spaces for you to answer in.`}
          {' '}It takes about a minute, and the spoken parts cost a few cents.
        </Help>
        <Group>
          <NavRow first label="Narrator" detail={narrator || defaultNarrator ? azureVoiceName(narrator || defaultNarrator!) : 'The server\'s own voice'} onPress={onNarrator} />
        </Group>
        {language === 'th' ? (
          <Card>
            <Segments
              options={[
                { value: 'khrap', label: 'ครับ (khrap)', accessibilityLabel: 'Khrap, a man\'s polite ending' },
                { value: 'kha', label: 'ค่ะ (kha)', accessibilityLabel: 'Kha, a woman\'s polite ending' },
              ]}
              value={particle}
              onChange={onParticle}
            />
            <Help>
              Every phrase you learn ends with this polite word, said in {particle === 'khrap' ? "the man's" : "the woman's"} voice, and
              you play {particle === 'khrap' ? 'the man' : 'the woman'} in the conversation at the end. It applies to lessons you make from now on.
            </Help>
          </Card>
        ) : null}
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
