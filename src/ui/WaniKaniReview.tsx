import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Keyboard, Linking, ScrollView, Text, TextInput, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { studyDayStart } from '../core/day';
import { checkMeaning, checkReading, type Verdict } from '../wanikani/answers';
import { problemText, WaniKaniError, type WaniKaniApi, type WaniKaniUser } from '../wanikani/api';
import { toKana } from '../wanikani/kana';
import { apprenticeBlocks, lessonsToday } from '../wanikani/prefs';
import { audioFileName, audioFor } from '../wanikani/production';
import {
  buildSession, canAskLater, canUndo, currentQuestion, questionMode, remaining, sessionItems, sessionProgress, startStudy,
  studyAnswer, studyAskLater, studyFlush, studyUndo, wrongSoFar, type Study,
} from '../wanikani/session';
import { nextStage, outcomeText } from '../wanikani/srs';
import { localAudioUri } from '../wanikani/storage';
import { SUBJECT_TYPE_NAMES, type Assignment, type Subject } from '../wanikani/subjects';
import { haptic } from './haptics';
import { Button, Count, ErrorNote, Icon, Screen, Tappable } from './kit';
import { Reveal } from './motion';
import { CardSurface, ProgressBar } from './Review';
import type { WaniKaniState } from './useWaniKani';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { SubjectDetails, SubjectFront } from './WaniKaniCard';

/** What a session is built from: WaniKani itself, or the offline copy when it can't be reached. */
interface Source {
  user: WaniKaniUser;
  reviews: Assignment[];
  lessons: Assignment[];
  started: number;
  apprentice: number;
  subjects: (ids: number[]) => Promise<Subject[]>;
  synonyms: (ids: number[]) => Promise<Map<number, string[]>>;
}

async function source(api: WaniKaniApi, wanikani: WaniKaniState): Promise<Source> {
  const copy = () => {
    const d = wanikani.offlineData();
    if (!d) return null;
    return {
      user: d.user, reviews: d.reviews, lessons: d.lessons, started: d.started, apprentice: d.apprentice,
      subjects: async (ids: number[]) => ids.flatMap((id) => d.subjects.get(id) ?? []),
      synonyms: async (ids: number[]) => new Map(ids.flatMap((id): [number, string[]][] => (d.synonyms.has(id) ? [[id, d.synonyms.get(id)!]] : []))),
    };
  };
  // Already known to be out of reach: no waiting on requests that won't be answered.
  if (wanikani.offline) {
    const d = copy();
    if (d) return d;
  }
  try {
    const user = wanikani.user ?? await api.user();
    const [reviews, lessons, started, apprentice] = await Promise.all([
      api.reviewsAvailable(user.maxLevel), api.lessonsAvailable(user.maxLevel),
      api.lessonsStartedSince(studyDayStart(new Date(), wanikani.dayStartsAtHour)),
      api.apprenticeCount(user.maxLevel),
    ]);
    return { user, reviews, lessons, started, apprentice, subjects: api.subjects, synonyms: api.synonyms };
  } catch (e) {
    const d = e instanceof WaniKaniError && e.problem !== 'unavailable' ? null : copy();
    if (d) return d;
    throw e;
  }
}

/**
 * Studies WaniKani, as a deck: today's reviews, or, when none are up or after they're done and
 * "Start lessons" is tapped, today's lessons. The two are never mixed in one session. Answers are typed or rated
 * (WaniKani's options), checked here, and sent to WaniKani as each item finishes, the latest held
 * back so it can be undone (src/wanikani/session.ts). WaniKani does the scheduling.
 */
export function WaniKaniReview({ wanikani, onDone, onOptions }: { wanikani: WaniKaniState; onDone: () => void; onOptions: () => void }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const { api, prefs, srs, send } = wanikani;
  const [subjects, setSubjects] = useState<Map<number, Subject>>(new Map());
  const [synonyms, setSynonyms] = useState<Map<number, string[]>>(new Map());
  const [study, setStudy] = useState<Study | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  // Reviews and lessons are separate sessions: the lessons one is started from the end of the reviews.
  const [lessonsOnly, setLessonsOnly] = useState(false);
  const [kind, setKind] = useState<'reviews' | 'lessons'>('reviews');
  // What the lessons are, once this session is done: how many are offered, and whether the Apprentice limit holds them back.
  const [next, setNext] = useState<{ lessons: number; held: boolean; apprentice: number }>({ lessons: 0, held: false, apprentice: 0 });
  // The current question's state: the answer shown, what was typed, and how it was judged.
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  // How answers are given is fixed for the session when it's built: its questions were made for it.
  const [typing, setTyping] = useState(prefs.answer === 'type');

  // Whatever is held when the screen closes goes to WaniKani then, and the deck list's counts are read again.
  const studyRef = useRef(study);
  studyRef.current = study;
  useEffect(() => () => {
    if (studyRef.current) send(studyFlush(studyRef.current).send);
    wanikani.refresh(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!api) return;
    let gone = false;
    setError(null);
    (async () => {
      try {
        const src = await source(api, wanikani);
        const { user, reviews, lessons, started, apprentice } = src;
        // Reviews first; lessons only when none are up or they were asked for.
        const lessonKind = lessonsOnly || reviews.length === 0;
        const offered = lessonsToday(lessons.length, prefs.newPerDay, started);
        const held = apprenticeBlocks(apprentice, prefs.maxApprentice) && offered > 0;
        const lessonCount = held ? 0 : offered;
        const read = new Map((await src.subjects((lessonKind ? lessons : reviews).map((a) => a.subjectId))).map((s) => [s.id, s]));
        const items = lessonKind ? sessionItems([], lessons, read, lessonCount) : sessionItems(reviews, [], read, 0);
        // The user's own synonyms count as right answers when typing; without them, only WaniKani's do.
        const typed = prefs.answer === 'type';
        const syn = typed ? await src.synonyms(items.map((i) => i.subjectId)).catch(() => new Map<number, string[]>()) : new Map<number, string[]>();
        if (gone) return;
        setSubjects(read);
        setSynonyms(syn);
        setKind(lessonKind ? 'lessons' : 'reviews');
        setNext({ lessons: lessonKind ? 0 : lessonCount, held, apprentice });
        setTyping(typed);
        setStudy(startStudy(buildSession(items, { mode: questionMode(prefs.answer, prefs.separate), lessonBatch: user.lessonBatch })));
      } catch (e) {
        if (gone) return;
        const why = e instanceof WaniKaniError ? e.problem : 'unavailable';
        setError(why === 'unavailable' ? `${problemText(why)} No offline copy has been saved yet: Franki makes one each time it reaches WaniKani.` : problemText(why));
      }
    })();
    return () => { gone = true; };
  }, [api, loads, lessonsOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // The typing box sits in the footer, so the screen is padded by the keyboard, as in Review.
  const insets = useSafeAreaInsets();
  const header = useHeaderInset();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // One player for WaniKani's recordings, released when the screen closes.
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { player.current?.remove(); player.current = null; }, []);
  // The recording kept on this phone when there is one (offline.ts), else WaniKani's.
  const audioUrl = (s: Subject | undefined) => {
    const a = s && audioFor(s);
    return a ? localAudioUri(audioFileName(s.id, a)) ?? a.url : undefined;
  };
  const play = useCallback((url: string | undefined) => {
    if (!url) return;
    player.current ??= createAudioPlayer(null, { keepAudioSessionActive: true });
    player.current.replace({ uri: url });
    player.current.play();
  }, []);

  const session = study?.session;
  const question = session ? currentQuestion(session) : undefined;
  const item = question && session ? session.items[question.assignmentId] : undefined;
  const subject = item ? subjects.get(item.subjectId) : undefined;
  const progress = question && session ? session.progress[question.assignmentId] : undefined;
  const left = session ? remaining(session) : { reviews: 0, lessons: 0 };
  const lesson = question?.kind === 'lesson';
  const asksMeaning = question?.kind === 'meaning' || question?.kind === 'both';
  const asksReading = question?.kind === 'reading' || question?.kind === 'both';
  // The answer side shows what's been asked, and what this item has already had right, never what's still to come.
  const showMeaning = lesson || (revealed && (asksMeaning || !!progress?.meaning));
  const showReading = lesson || (revealed && (asksReading || !!progress?.reading));

  const resetQuestion = () => {
    setRevealed(false);
    setTyped('');
    setVerdict(null);
    setRetry(null);
  };

  // Time on each item, for Stats: from when each question came up to its answer, at most a minute
  // a question (as Anki caps an answer's time), added up over the item's questions.
  const shownAt = useRef(Date.now());
  const itemMs = useRef(new Map<number, number>());
  useEffect(() => { shownAt.current = Date.now(); }, [question, study?.session.queue.length]);

  const answer = (correct: boolean) => {
    if (!study || !question) return;
    haptic.answer();
    const ms = (itemMs.current.get(question.assignmentId) ?? 0) + Math.min(60_000, Date.now() - shownAt.current);
    itemMs.current.set(question.assignmentId, ms);
    const r = studyAnswer(study, correct, new Date());
    // The outcome this answer made (if it finished an item) is the one now held: it gets the item's time.
    const held = r.study.held ? { ...r.study.held, takenMs: ms } : null;
    send(r.send);
    setStudy({ ...r.study, held });
    resetQuestion();
    if (!currentQuestion(r.study.session)) haptic.success();
  };

  const undo = () => {
    const back = study && studyUndo(study);
    if (!back) return;
    setStudy(back);
    resetQuestion();
  };

  // Moves the question to the back of its pile without answering it, so nothing is counted wrong.
  const later = () => {
    if (!study) return;
    setStudy(studyAskLater(study));
    resetQuestion();
  };

  const reveal = () => {
    Keyboard.dismiss();
    setRevealed(true);
    if (prefs.autoplay && asksReading) play(audioUrl(subject));
  };

  const check = () => {
    if (!subject || !question) return;
    if (verdict) return answer(verdict.result === 'correct');
    const v = question.kind === 'reading' ? checkReading(subject, typed) : checkMeaning(subject, synonyms.get(subject.id) ?? [], typed);
    if (v.result === 'retry') {
      setRetry(v.message);
      return;
    }
    setRetry(null);
    setVerdict(v);
    setRevealed(true);
    if (v.result === 'correct') haptic.select();
    if (prefs.autoplay && question.kind === 'reading') play(audioUrl(subject));
  };

  const title = 'WaniKani';
  // Only before the question is answered or its answer is shown, so it can't be used to dodge a miss.
  const askable = !!session && canAskLater(session) && !verdict && !revealed;
  const menu = useMemo(() => (subject ? () => {
    const options = [...(askable ? ['Ask later'] : []), 'Open on wanikani.com', 'WaniKani options', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (i) => {
      const picked = options[i];
      if (picked === 'Ask later') later();
      if (picked === 'Open on wanikani.com' && subject.url) Linking.openURL(subject.url).catch(() => undefined);
      if (picked === 'WaniKani options') onOptions();
    });
  } : undefined), [subject, onOptions, askable, study]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolbar = (
    <Stack.Toolbar placement="right">
      {study && canUndo(study) ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel="Undo the last answer" onPress={undo} /> : null}
      {menu ? <Stack.Toolbar.Button icon="ellipsis.circle" accessibilityLabel="More: ask later, open on wanikani.com or WaniKani's options" onPress={menu} /> : null}
    </Stack.Toolbar>
  );

  if (!api) {
    return (
      <Screen title={title} largeTitle={false} footer={<Button label="WaniKani options" onPress={onOptions} />}>
        <View style={{ flex: 1, justifyContent: 'center', padding: space.xl }}>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>WaniKani is off. Enter a token in its options to study it here.</Text>
        </View>
      </Screen>
    );
  }

  if (!study || error) {
    return (
      <Screen title={title} largeTitle={false} footer={error ? <Button label="Back to decks" variant="secondary" onPress={onDone} /> : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xl, gap: space.m }}>
          {error ? <ErrorNote message={error} onRetry={() => setLoads((n) => n + 1)} /> : <ActivityIndicator color={c.accent} />}
        </View>
      </Screen>
    );
  }

  if (!question || !item || !subject) {
    const done = study.session.finished.length;
    // Lessons wait for a tap rather than following the reviews on their own. Held answers are sent
    // and counts read again first, so the Apprentice limit is checked against the reviews just done.
    const startLessons = async () => {
      send(studyFlush(study).send);
      setStudy(null);
      await wanikani.refresh(true);
      setLessonsOnly(true);
    };
    const offer = kind === 'reviews' && next.lessons > 0;
    const footer = offer ? (
      <>
        <Button label={`Start ${next.lessons} ${next.lessons === 1 ? 'lesson' : 'lessons'}`} onPress={startLessons} />
        <Button label="Back to decks" variant="secondary" onPress={onDone} />
      </>
    ) : <Button label="Back to decks" onPress={onDone} />;
    return (
      <Screen title={title} largeTitle={false} toolbar={toolbar} footer={footer}>
        <Reveal style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s, padding: space.xl }}>
          <Icon name="checkmark.circle.fill" size={56} color={c.countDue} weight="regular" />
          <Text style={{ ...type.title, color: c.text, textAlign: 'center', marginTop: space.s }}>All done for now</Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {done ? `${done} ${done === 1 ? 'item' : 'items'} this session. ` : ''}{kind === 'reviews' && offer ? 'Your lessons are ready when you want them.' : 'Nothing else is up on WaniKani right now.'}
          </Text>
          {next.held && prefs.maxApprentice !== null ? (
            <Text style={{ ...type.subhead, color: c.warning, textAlign: 'center' }}>
              {`Lessons are paused: ${next.apprentice} items are at Apprentice, over your limit of ${prefs.maxApprentice}.`}
            </Text>
          ) : null}
        </Reveal>
      </Screen>
    );
  }

  const label = lesson
    ? `New ${SUBJECT_TYPE_NAMES[subject.type].toLowerCase()} · Level ${subject.level}`
    : `${item.lesson ? 'Lesson quiz · ' : ''}${SUBJECT_TYPE_NAMES[subject.type]}${question.kind === 'meaning' && item.asksReading ? ' meaning' : question.kind === 'reading' ? ' reading' : ''}${item.lesson ? '' : ` · Level ${subject.level}`}`;
  const system = srs.get(subject.srsId);
  const wrong = wrongSoFar(study.session, item.assignmentId);
  // Whether a right answer now finishes the item (and so what Good does to it).
  const finishes = question.kind === 'both' || (question.kind === 'meaning' ? progress?.reading : progress?.meaning);
  // A lesson quiz's miss only asks again; a review's moves the item down.
  const againDetail = item.lesson ? 'Asked again' : outcomeText(nextStage(item.srsStage, wrong + 1, system), system);

  let footer: React.ReactNode;
  if (lesson) {
    // The last lesson of a batch leads into its quiz.
    footer = <Button label={study.session.queue[1]?.kind === 'lesson' ? 'Next' : 'Start the quiz'} onPress={() => answer(true)} />;
  } else if (typing) {
    const result = verdict?.result;
    footer = (
      <>
        {retry ? <Text style={{ ...type.subhead, color: c.warning, textAlign: 'center' }}>{retry}</Text> : null}
        {verdict?.result === 'correct' && verdict.close ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Close enough: check the spelling.</Text> : null}
        <TextInput
          key={`${item.assignmentId}:${question.kind}:${session!.finished.length}`}
          value={typed}
          onChangeText={(t) => { if (!verdict) setTyped(question.kind === 'reading' ? toKana(t) : t); }}
          onSubmitEditing={check}
          submitBehavior="submit"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType={verdict ? 'next' : 'done'}
          placeholder={question.kind === 'reading' ? 'Reading' : 'Meaning'}
          accessibilityLabel={question.kind === 'reading' ? 'Type the reading' : 'Type the meaning'}
          placeholderTextColor={result ? c.onRating : c.textTertiary}
          selectionColor={c.accent}
          keyboardAppearance={dark ? 'dark' : 'light'}
          style={{
            ...type.body, textAlign: 'center', ...smooth, borderRadius: radius.m, borderWidth: hairline, minHeight: MIN_TAP,
            paddingHorizontal: space.m, paddingVertical: space.s,
            color: result ? c.onRating : c.text,
            backgroundColor: result === 'correct' ? c.good : result === 'wrong' ? c.again : c.surface,
            borderColor: result ? 'transparent' : c.border,
          }}
        />
        {result === 'wrong' ? <Button label="Mark as correct" variant="secondary" onPress={() => answer(true)} /> : null}
        <Button
          label={!verdict ? 'Check' : finishes || result === 'wrong' ? 'Next' : 'Next question'}
          onPress={check}
          disabled={!verdict && !typed.trim()}
        />
      </>
    );
  } else if (!revealed) {
    footer = <Button label="Show answer" onPress={reveal} />;
  } else {
    footer = (
      <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
        <RateButton label="Again" detail={againDetail} color={c.again} onPress={() => answer(false)} />
        <RateButton
          label="Good"
          detail={finishes ? outcomeText(nextStage(item.srsStage, wrong, system), system) : question.kind === 'meaning' ? 'Reading to come' : 'Meaning to come'}
          color={c.good}
          onPress={() => answer(true)}
        />
      </Reveal>
    );
  }

  return (
    <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <Screen title={title} largeTitle={false} toolbar={toolbar} footer={footer}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          {kind === 'reviews' ? <Count value={left.reviews} label="due" color={c.countDue} /> : <Count value={left.lessons} label="new" color={c.countNew} />}
        </View>
        {wanikani.offline ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Offline. Answers are sent when WaniKani can be reached.</Text>
        ) : null}
        <ProgressBar value={sessionProgress(study.session)} />
        <CardSurface>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.xl, paddingTop: space.xxl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}
          >
            <Reveal key={`${item.assignmentId}:${question.kind}:${study.session.finished.length}:${study.session.queue.length}`} rise={10} style={{ gap: space.xl }}>
              <SubjectFront subject={subject} label={label} />
              {showMeaning || showReading ? (
                <>
                  <View style={{ height: hairline, backgroundColor: c.border }} />
                  <SubjectDetails
                    key={`${subject.id}:${question.kind}`}
                    subject={subject}
                    showMeaning={showMeaning}
                    showReading={showReading}
                    synonyms={synonyms.get(subject.id) ?? []}
                    lesson={lesson}
                    onPlay={audioUrl(subject) ? () => { haptic.tap(); play(audioUrl(subject)); } : undefined}
                  />
                </>
              ) : null}
            </Reveal>
          </ScrollView>
        </CardSurface>
      </Screen>
    </View>
  );
}

/** An answer button, with what it does over its label, as on the other decks. */
function RateButton({ label, detail, color, onPress }: { label: string; detail: string; color: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${detail}`}
      scaleTo={0.95}
      dimTo={0.85}
      style={{ flex: 1, minHeight: 60, borderRadius: radius.m + 2, ...smooth, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: color }}
    >
      <Text style={{ ...type.caption, color: c.onRating }}>{detail}</Text>
      <Text style={{ ...type.headline, color: c.onRating }}>{label}</Text>
    </Tappable>
  );
}
