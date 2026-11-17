import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Keyboard, Linking, ScrollView, Text, TextInput, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { studyDayStart } from '../core/day';
import { checkMeaning, checkReading, type Verdict } from '../wanikani/answers';
import { failureText } from '../core/failure';
import { problemText, WaniKaniError, type WaniKaniApi, type WaniKaniUser } from '../wanikani/api';
import { toKana } from '../core/kana';
import { offlineText } from '../wanikani/offline';
import { canSkip, withoutSkipped } from '../wanikani/skipped';
import { droppedText, lessonsToday } from '../wanikani/prefs';
import { audioFileName, audioFor } from '../wanikani/production';
import {
  buildSession, canAskLater, canMarkCorrect, canSaveMeaning, canUndo, currentQuestion, questionMode, remaining, sessionItems, sessionProgress, startStudy,
  dropItem, studyAnswer, studyAskLater, studyFlush, studyUndo, wrongSoFar, type Study,
} from '../wanikani/session';
import { nextStage, outcomeText, stageChange, type StageChange } from '../wanikani/srs';
import { stackSlots } from '../wanikani/stagePopups';
import { localAudioUri } from '../wanikani/storage';
import { madeOf, SUBJECT_TYPE_NAMES, withComponents, type Assignment, type Subject } from '../wanikani/subjects';
import { haptic } from './haptics';
import { Button, Count, ErrorNote, Icon, ProgressBar, Screen, Tappable } from './kit';
import { Reveal } from './motion';
import { CardSurface } from './Review';
import { useAnswerFlash } from './SwipeCard';
import type { WaniKaniState } from './useWaniKani';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { StagePopup } from './StagePopup';
import { useStagePopups } from './useStagePopups';
import { QuestionBand, SubjectDetails, SubjectFront, subjectColor } from './WaniKaniCard';

/** What a session is built from: WaniKani itself, or the offline copy when it can't be reached. */
interface Source {
  user: WaniKaniUser;
  reviews: Assignment[];
  lessons: Assignment[];
  started: number;
  apprentice: number;
  subjects: (ids: number[]) => Promise<Subject[]>;
  synonyms: (ids: number[]) => Promise<Map<number, string[]>>;
  /** When the offline copy was made, when the session comes from it. */
  savedAt?: Date;
}

async function source(api: WaniKaniApi, wanikani: WaniKaniState): Promise<Source> {
  const copy = () => {
    const d = wanikani.offlineData();
    if (!d) return null;
    return {
      user: d.user, reviews: d.reviews, lessons: d.lessons, started: d.started, apprentice: d.apprentice, savedAt: d.savedAt,
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
    // Read before and after: one sent while WaniKani's list was being read may or may not be in it.
    const waitingBefore = wanikani.unsentAssignments();
    const user = wanikani.user ?? await api.user();
    const [reviews, lessons, started, apprentice] = await Promise.all([
      api.reviewsAvailable(user.maxLevel), api.lessonsAvailable(user.maxLevel),
      api.lessonsStartedSince(studyDayStart(new Date(), wanikani.dayStartsAtHour)),
      api.apprenticeCount(user.maxLevel),
    ]);
    // An answer still waiting to be sent hasn't reached WaniKani, which lists its item as up: it's
    // left out, as the offline copy leaves it out, so it isn't asked (and logged) a second time.
    const waiting = new Set([...waitingBefore, ...wanikani.unsentAssignments()]);
    return {
      user, reviews: reviews.filter((a) => !waiting.has(a.id)), lessons: lessons.filter((a) => !waiting.has(a.id)), started, apprentice,
      subjects: api.subjects, synonyms: api.synonyms,
    };
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
  const { api, prefs, srs, send, seenDropped, skip } = wanikani;
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
  // When the offline copy this session was built from was made; null when it came from WaniKani.
  const [copySavedAt, setCopySavedAt] = useState<Date | null>(null);
  // How many refused answers this screen has said were dropped: marked seen as it closes.
  const shownDropped = useRef(0);
  // The stage popups for the latest answers: a new one stacks over the ones still showing, each on its own timer.
  const popups = useStagePopups();
  // The popup a typed answer showed when it was judged, so a different answer can take it down again.
  const checkPopup = useRef<number | null>(null);
  const showStage = (change: StageChange) => popups.show(change);
  // A miss that moves the item into a lower group says so at once, not when the item finally finishes.
  // A second miss shows again only if it drops a further group.
  const missPopup = (assignmentId: number): number | null => {
    const it = study?.session.items[assignmentId];
    if (!study || !it || it.lesson) return null;
    const sys = srs.get(subjects.get(it.subjectId)?.srsId ?? 1);
    const w = wrongSoFar(study.session, assignmentId);
    const change = stageChange(it.srsStage, w + 1, sys);
    const before = stageChange(it.srsStage, w, sys);
    return change && change.group !== before?.group ? showStage(change) : null;
  };

  // Whatever is held when the screen closes goes to WaniKani then, and the deck list's counts are read again.
  const studyRef = useRef(study);
  studyRef.current = study;
  useEffect(() => () => {
    // Before sending, so any refused in this last send are still shown on the deck list.
    seenDropped(shownDropped.current);
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
        const lessonCount = lessonsToday(lessons.length, prefs.newPerDay, started, apprentice, prefs.maxApprentice);
        const held = lessonCount === 0 && offered > 0;
        // With the radicals and kanji they're made of, for the "Made of" row: one more batched read.
        const own = await src.subjects((lessonKind ? lessons : reviews).map((a) => a.subjectId));
        const read = new Map((await withComponents(own, src.subjects)).map((s) => [s.id, s]));
        const items = lessonKind ? sessionItems([], lessons, read, lessonCount) : sessionItems(withoutSkipped(reviews, wanikani.skipped), [], read, 0);
        // The user's own synonyms count as right answers when typing; without them, only WaniKani's do.
        const typed = prefs.answer === 'type';
        const syn = typed ? await src.synonyms(items.map((i) => i.subjectId)).catch(() => new Map<number, string[]>()) : new Map<number, string[]>();
        if (gone) return;
        setSubjects(read);
        setSynonyms(syn);
        setCopySavedAt(src.savedAt ?? null);
        setKind(lessonKind ? 'lessons' : 'reviews');
        setNext({ lessons: lessonKind ? 0 : lessonCount, held, apprentice });
        setTyping(typed);
        setStudy(startStudy(buildSession(items, { mode: questionMode(prefs.answer, prefs.separate), lessonBatch: user.lessonBatch }), typed));
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
  // The answer side shows only what this question asked. An item's meaning and reading are separate
  // questions, and showing one's answer on the other's card gives that answer away when it comes up
  // (a missed question is asked again a few cards later), even if this item has already had it right.
  const showMeaning = lesson || (revealed && asksMeaning);
  const showReading = lesson || (revealed && asksReading);

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

  // The session last answered from: two taps before a re-render would both answer it, sending the
  // held answer to WaniKani and logging it twice.
  const answeredFrom = useRef<Study | null>(null);
  const starting = useRef(false);
  // The card washes green or red as an answer is given, as Review's does.
  const answerFlash = useAnswerFlash();
  const answer = (correct: boolean) => {
    if (!study || !question || answeredFrom.current === study) return;
    answeredFrom.current = study;
    haptic.answer();
    answerFlash.flash(correct ? 3 : 1);
    const ms = (itemMs.current.get(question.assignmentId) ?? 0) + Math.min(60_000, Date.now() - shownAt.current);
    itemMs.current.set(question.assignmentId, ms);
    const r = studyAnswer(study, correct, new Date());
    // The outcome this answer made (if it finished an item) is the one now held: it gets the item's time.
    const held = r.study.held ? { ...r.study.held, takenMs: ms } : null;
    send(r.send);
    setStudy({ ...r.study, held });
    resetQuestion();
    // An item that crossed into another stage group says so, by what WaniKani will do with this answer.
    const outcome = r.study.held;
    const change = outcome?.kind === 'review' ? stageChange(outcome.srsStage, outcome.wrongMeaning + outcome.wrongReading, srs.get(subjects.get(outcome.subjectId)?.srsId ?? 1)) : null;
    // A typed answer already showed its popup when it was judged (a rise when it finished the item, a
    // drop when it missed): leave that one up. A marked-correct answer or a button press shows it now.
    const shownAtCheck = !!verdict && verdict.result === (correct ? 'correct' : 'wrong');
    // The popup of the check, if there was one and this answer differs from it, comes down.
    const shownBefore = checkPopup.current;
    checkPopup.current = null;
    if (!shownAtCheck) {
      if (shownBefore !== null) popups.hide(shownBefore);
      if (change?.up) showStage(change);
      else if (!correct) missPopup(question.assignmentId);
    }
    if (!currentQuestion(r.study.session)) haptic.success();
    else if (change) change.burned ? haptic.success() : haptic.select();
  };

  const undo = () => {
    // A typed answer judged wrong and not yet counted (before Next) still counts as a miss.
    const back = study && studyUndo(study, verdict?.result === 'wrong');
    if (!back) return;
    haptic.tap();
    answeredFrom.current = null;
    setStudy(back);
    resetQuestion();
    checkPopup.current = null;
    popups.hideAll();
  };

  // Moves the question to the back of its pile without answering it, so nothing is counted wrong.
  const later = () => {
    if (!study) return;
    answeredFrom.current = null;
    setStudy(studyAskLater(study));
    resetQuestion();
  };

  const reveal = () => {
    Keyboard.dismiss();
    setRevealed(true);
    if (prefs.autoplay && asksReading) play(audioUrl(subject));
  };

  // A lesson shows the answer at once, so a word's recording plays as it comes up, as it does on reveal.
  const lessonKey = lesson && subject && session ? `${subject.id}:${session.finished.length}:${session.queue.length}` : null;
  useEffect(() => {
    if (lessonKey && prefs.autoplay) play(audioUrl(subject));
  }, [lessonKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (v.result === 'correct') {
      haptic.select();
      // The stage popup comes with the right answer, not with the Next press after it.
      const q = question;
      const it = study?.session.items[q.assignmentId];
      const pr = study?.session.progress[q.assignmentId];
      const finishesItem = q.kind === 'both' || (q.kind === 'meaning' ? pr?.reading : pr?.meaning);
      if (study && it && !it.lesson && finishesItem) {
        const change = stageChange(it.srsStage, wrongSoFar(study.session, it.assignmentId), srs.get(subjects.get(it.subjectId)?.srsId ?? 1));
        if (change?.up) checkPopup.current = showStage(change);
      }
    } else {
      checkPopup.current = missPopup(question.assignmentId);
    }
    if (prefs.autoplay && question.kind === 'reading') play(audioUrl(subject));
  };

  // A wrong typed answer the learner knows was right: counted right, and for a meaning optionally kept as a synonym on WaniKani too.
  const saving = useRef(false);
  const notRight = () => {
    if (!study || !question || !subject) return;
    const q = question;
    const word = subject;
    const text = typed.trim();
    const canSave = canSaveMeaning(q) && !!text;
    const options = ['Mark as correct', ...(canSave ? [`Save "${text}" as a correct meaning`] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, async (i) => {
      const picked = options[i];
      if (picked === 'Mark as correct') answer(true);
      if (!canSave || picked !== options[1] || !api || saving.current) return;
      saving.current = true;
      try {
        await api.addSynonym(word.id, text);
      } catch (e) {
        Alert.alert("Couldn't save the meaning", failureText(e instanceof WaniKaniError ? new Error(problemText(e.problem)) : e, { next: 'It needs a connection to WaniKani. Try again, or mark the answer correct without saving it.' }));
        return;
      } finally {
        saving.current = false;
      }
      setSynonyms((m) => new Map(m).set(word.id, [...(m.get(word.id) ?? []), text]));
      // The screen may have moved on while the request was out: only this question is marked correct.
      if (studyRef.current === study) answer(true);
    });
  };

  // The word is left out of this session and every later one; WaniKani still has it, and the options list it to bring it back.
  const confirmSkip = () => {
    if (!study || !question || !subject) return;
    const assignmentId = question.assignmentId;
    const word = subject;
    const name = word.characters ?? word.meanings[0]?.meaning ?? 'this word';
    Alert.alert(
      `Skip ${name} for good?`,
      "It won't come up in reviews on this iPhone again. WaniKani still schedules it, so it stays due on wanikani.com. You can bring it back in WaniKani's options.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: () => {
            // Only a question of this word is cleared: the screen may have moved on while the alert was open.
            const onIt = studyRef.current && currentQuestion(studyRef.current.session)?.assignmentId === assignmentId;
            skip(word, assignmentId);
            setStudy((s) => (s ? dropItem(s, assignmentId) : s));
            if (onIt) resetQuestion();
            checkPopup.current = null;
            popups.hideAll();
          },
        },
      ],
    );
  };

  const title = 'WaniKani';
  // Only before the question is answered or its answer is shown, so it can't be used to dodge a miss.
  const askable = !!session && canAskLater(session) && !verdict && !revealed;
  const menu = useMemo(() => (subject ? () => {
    const skippable = canSkip(subject) && !lesson && !!question;
    const options = [...(askable ? ['Ask later'] : []), ...(skippable ? ['Skip this word for good'] : []), 'Open on wanikani.com', 'WaniKani options', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (i) => {
      const picked = options[i];
      if (picked === 'Ask later') later();
      if (picked === 'Skip this word for good') confirmSkip();
      if (picked === 'Open on wanikani.com' && subject.url) Linking.openURL(subject.url).catch(() => undefined);
      if (picked === 'WaniKani options') onOptions();
    });
  } : undefined), [subject, onOptions, askable, study, lesson, question]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolbar = (
    <Stack.Toolbar placement="right">
      {study && canUndo(study) ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel="Undo the last answer" onPress={undo} /> : null}
      {menu ? <Stack.Toolbar.Button icon="ellipsis.circle" accessibilityLabel="More: ask later, skip this word, open on wanikani.com or WaniKani's options" onPress={menu} /> : null}
    </Stack.Toolbar>
  );

  // Refused answers are said with the session and at its end; those said are marked seen as the screen closes.
  const droppedNote = () => {
    if (!wanikani.dropped) return null;
    shownDropped.current = wanikani.dropped;
    return <Text style={{ ...type.subhead, color: c.warning, textAlign: 'center' }}>{droppedText(wanikani.dropped)}</Text>;
  };

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
      // A second tap before the re-render would send the held answer again.
      if (starting.current) return;
      starting.current = true;
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
        <Reveal style={{ flex: 1 }}>
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, flexGrow: 1, alignItems: 'center', gap: space.s, padding: space.xl }}>
          <Icon name="checkmark.circle.fill" size={56} color={c.countDue} weight="regular" />
          <Text style={{ ...type.title, color: c.text, textAlign: 'center', marginTop: space.s }}>All done for now</Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {done ? `${done} ${done === 1 ? 'item' : 'items'} this session. ` : ''}{kind === 'reviews' && offer ? 'Your lessons are ready when you want them.' : 'Nothing else is up on WaniKani right now.'}
          </Text>
          {droppedNote()}
          {next.held && prefs.maxApprentice !== null ? (
            <Text style={{ ...type.subhead, color: c.warning, textAlign: 'center' }}>
              {`Lessons are paused: ${next.apprentice} ${next.apprentice === 1 ? 'item is' : 'items are'} at Apprentice, at your limit of ${prefs.maxApprentice}.`}
            </Text>
          ) : null}
          </ScrollView>
        </Reveal>
      </Screen>
    );
  }

  const label = lesson
    ? `New ${SUBJECT_TYPE_NAMES[subject.type].toLowerCase()} · Level ${subject.level}`
    : `${item.lesson ? 'Lesson quiz · ' : ''}${SUBJECT_TYPE_NAMES[subject.type]}${item.lesson ? '' : ` · Level ${subject.level}`}`;
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
          editable={!verdict}
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
        {result === 'wrong' && canMarkCorrect(question) ? <Button label="Not right?" variant="secondary" onPress={notRight} /> : null}
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

  const slots = stackSlots(popups.stack);
  return (
    <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
      <Screen title={title} largeTitle={false} toolbar={toolbar} footer={footer}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          {kind === 'reviews' ? <Count value={left.reviews} label="remaining" color={c.countDue} /> : <Count value={left.lessons} label="new" color={c.countNew} />}
        </View>
        {copySavedAt || wanikani.offline ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
            {`${copySavedAt ? `${offlineText(copySavedAt, new Date(), wanikani.dayStartsAtHour)}.` : 'Offline.'} Answers are sent when WaniKani can be reached.`}
          </Text>
        ) : null}
        {droppedNote()}
        <ProgressBar value={sessionProgress(study.session)} style={{ marginHorizontal: space.l, marginTop: space.xs }} />
        <CardSurface color={subjectColor(c, subject.type)}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.xl, paddingTop: space.xxl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}
          >
            <Reveal key={`${item.assignmentId}:${question.kind}:${study.session.finished.length}:${study.session.queue.length}`} rise={10} style={{ gap: space.xl }}>
              <SubjectFront subject={subject} label={label} />
              {showMeaning || showReading ? (
                <>
                  <View style={{ height: hairline, backgroundColor: c.wkLine }} />
                  <SubjectDetails
                    key={`${subject.id}:${question.kind}`}
                    subject={subject}
                    parts={madeOf(subject, subjects)}
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
          {/* What's asked, at the card's foot beside the answer: light for the meaning, dark for the reading. */}
          {/* The stage popup hangs off this view's top edge: just above the band, or the card's foot in a lesson. */}
          <View>
            {question.kind !== 'lesson' ? <QuestionBand kind={question.kind} /> : null}
            {popups.stack.map((e, i) => <StagePopup key={e.id} change={e.change} side={e.side} slot={slots[i]} animate={prefs.stageAnimation} />)}
          </View>
          {answerFlash.overlay}
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
