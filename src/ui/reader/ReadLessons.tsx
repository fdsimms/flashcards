import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { ApiError, type Api, type AudioLesson, type Language, type LessonReview } from '../../reader/api';
import { LANGUAGES } from '../../reader/languages';
import { anyMaking, lessonDetail, POLL_MS, type Particle } from '../../reader/lessons';
import { lessonRequestWords } from '../../core/lessonWords';
import { Button, Card, ErrorNote, Field, Group, Help, NavRow, Screen, SwipeAction, SwipeToReveal } from '../kit';
import { LessonMakingRow } from './LessonMakingRow';
import { LessonReviewCard } from './LessonReviewCard';
import { LessonTopics } from './LessonTopics';
import { LessonWords } from './LessonWords';
import { useLessonWords } from './useLessonWords';
import { useConnectionProblem } from '../connection';
import { useLessonDownloads } from './useLessonDownloads';
import { lessonItem } from '../../reader/audioQueue';
import { useQueueMenu } from '../useQueueMenu';
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
  // The review on offer, and asking for it.
  const [review, setReview] = useState<LessonReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // The row slid open on its Delete action; one at a time.
  const [openLesson, setOpenLesson] = useState<number | null>(null);
  const chosen = useLessonWords(language);
  const downloadButton = useLessonDownloads(api);
  const queueMenu = useQueueMenu();
  const problem = useConnectionProblem();
  const scroller = useRef<ScrollViewInstance>(null);
  // Where the list of lessons starts in the scroll view, and which lessons were being made at the last load.
  const listTop = useRef(0);
  const wasMaking = useRef<Set<number>>(new Set());
  const headerHeight = useHeaderHeight();

  const load = useCallback(async () => {
    try {
      const listed = await api.lessons(language);
      setLessons(listed.lessons);
      setReview(listed.review ?? null);
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

  // When a lesson being made turns ready, bring the list to the top of the screen so it's in view.
  // (iOS insets the content by the header, so the offset is taken from below it.)
  useEffect(() => {
    if (lessons === null) return;
    const finished = lessons.some((l) => l.state === 'ready' && wasMaking.current.has(l.id));
    wasMaking.current = new Set(lessons.filter((l) => l.state === 'making').map((l) => l.id));
    if (finished) requestAnimationFrame(() => scroller.current?.scrollTo({ y: listTop.current - headerHeight - space.m, animated: true }));
  }, [lessons, headerHeight]);

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

  const makeReview = async () => {
    if (reviewing) return;
    setReviewing(true);
    setReviewError(null);
    try {
      await api.makeReview(language, narrator || undefined, language === 'th' ? particle : undefined);
      await load();
    } catch (e) {
      setReviewError(e instanceof ApiError ? e.message : "Couldn't ask for the review. Try again.");
    } finally {
      setReviewing(false);
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

  // A lesson that failed has nothing to play, so tapping it offers to delete it; swiping a row does too.
  const confirmDelete = (lesson: AudioLesson) => {
    const why = lesson.state === 'failed' ? `"${lesson.title}" didn't finish, so there's nothing to play.` : `"${lesson.title}" will be deleted from your server and this iPhone. This can't be undone.`;
    Alert.alert('Delete this lesson?', why, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove(lesson) },
    ]);
  };

  return (
    <Screen title="Audio lessons" toolbar={toolbar}>
      <ScrollView
        ref={scroller}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      >
        {review ? <LessonReviewCard review={review} onMake={makeReview} busy={reviewing} error={reviewError} /> : null}
        <Card>
          <Field
            label="New lesson"
            value={scene}
            onChangeText={setScene}
            placeholder={chosen.words.length ? "Where you'd use them, like at a cafe" : "Ordering a coffee"}
            maxLength={200}
            returnKeyType="done"
            onSubmitEditing={make}
          />
          <LessonTopics api={api} language={language} words={chosen.words} onPick={setScene} />
          <LessonWords words={chosen.words} onRemove={chosen.remove} onClear={chosen.clear} />
          <Button label="Make a lesson" onPress={make} busy={asking} disabled={!scene.trim()} />
          {askError ? <ErrorNote message={askError} /> : null}
        </Card>
        <Help>
          {chosen.words.length
            ? `Claude writes the dialogue around your ${chosen.words.length === 1 ? 'word' : `${chosen.words.length} words`} and teaches every one of them, and a voice records the lesson with spaces for you to answer in.`
            : `Claude writes about five ${LANGUAGES[language].name} words to teach in that scene, and a voice records the lesson with spaces for you to answer in.`}
          {' '}It takes about a minute, and the spoken parts cost a few cents.
        </Help>
        {error ? <ErrorNote message={error} onRetry={load} /> : null}
        {lessons === null && !error ? <ActivityIndicator color={c.accent} style={{ marginTop: space.xl }} /> : null}
        {problem ? <Help>{problem === 'offline' ? "You're offline, so only lessons on this iPhone are listed." : "Couldn't reach your server, so only lessons on this iPhone are listed."}</Help> : null}
        {lessons !== null && lessons.length === 0 && !problem ? <Help>No lessons yet. Type a scene above to make your first.</Help> : null}
        {lessons !== null && lessons.length > 0 ? (
          <View onLayout={(e) => { listTop.current = e.nativeEvent.layout.y; }}>
          <Group>
            {lessons.map((l, i) => (
              <View key={l.id}>
                {l.state === 'making' ? (
                  <LessonMakingRow lesson={l} first={i === 0} />
                ) : (
                  <SwipeToReveal
                    open={openLesson === l.id}
                    onOpenChange={(open) => setOpenLesson(open ? l.id : null)}
                    onFullSwipe={() => confirmDelete(l)}
                    action={<SwipeAction destructive icon="trash" label="Delete" accessibilityLabel={`Delete ${l.title}`} onPress={() => { setOpenLesson(null); confirmDelete(l); }} />}
                  >
                    <NavRow
                      first={i === 0}
                      label={l.title}
                      detail={lessonDetail(l)}
                      // Tapping a row that's slid open closes it, rather than opening the lesson.
                      onPress={() => (openLesson === l.id ? setOpenLesson(null) : l.state === 'ready' ? onOpen(l) : confirmDelete(l))}
                      onLongPress={l.state === 'ready' ? () => queueMenu(lessonItem(l)) : undefined}
                      action={l.state === 'failed' ? { icon: 'trash', label: `Delete ${l.title}`, onPress: () => confirmDelete(l) } : l.state === 'ready' ? downloadButton(l) : undefined}
                    />
                  </SwipeToReveal>
                )}
              </View>
            ))}
          </Group>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
