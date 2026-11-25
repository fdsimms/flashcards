import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Stack, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, Keyboard, Linking, Pressable, ScrollView, Text, TextInput, useColorScheme, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { studyDayStart } from '../core/day';
import { checkMeaning, checkReading, type Verdict } from '../wanikani/answers';
import { problemText, WaniKaniError, type WaniKaniApi, type WaniKaniUser } from '../wanikani/api';
import { withPending } from '../wanikani/synonyms';
import { toKana } from '../core/kana';
import { offlineText } from '../wanikani/offline';
import { canSkip, withoutSkipped } from '../wanikani/skipped';
import { droppedText, lessonsToday } from '../wanikani/prefs';
import { audioFileName, audioFor } from '../wanikani/production';
import {
  buildSession, canAskLater, canMarkCorrect, canSaveMeaning, canUndo, currentQuestion, isTyped, questionMode, remaining, sessionItems, sessionProgress, startStudy, type QuestionKind, type Session, type TypedKinds,
  canCredit, dropItem, missedItems, studyAnswer, studyCredit, studyAskLater, studyFlush, studyUndo, wrongSoFar, type Study,
} from '../wanikani/session';
import { nextStage, outcomeText, stageChange, type StageChange } from '../wanikani/srs';
import { stackSlots } from '../wanikani/stagePopups';
import { localAudioUri } from '../wanikani/storage';
import { madeOf, SUBJECT_TYPE_NAMES, withComponents, type Assignment, type Subject } from '../wanikani/subjects';
import { useKeyboardInset } from './useKeyboardInset';
import { haptic } from './haptics';
import { Button, Count, ErrorNote, Icon, Loading, ProgressBar, Screen, Tappable } from './kit';
import { LessonsPausedNote } from './LessonsPausedNote';
import { Reveal } from './motion';
import { CardSurface } from './Review';
import { useAnswerFlash } from './SwipeCard';
import type { WaniKaniState } from './useWaniKani';
import { hairline, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';
import { useHeaderInset } from './useHeaderInset';
import { useMiniCram } from './useMiniCram';
import { useOutputWake } from './useOutputWake';
import { trackPlayer } from './useSoundingButton';
import { StagePopup } from './StagePopup';
import { useStagePopups } from './useStagePopups';
import { WaniKaniMissList } from './WaniKaniMisses';
import { CardContent, CardTools, hasMnemonicPanel, MnemonicsPanel, QuestionBand, subjectColor } from './WaniKaniCard';

/** The longest the card's resize after the keyboard may take (ms). */
const KEYBOARD_SLIDE_MS = 150;
/** How long a new typed question keeps the keyboard's last height reserved while waiting for it to show (ms). */
const KEYBOARD_HOLD_MS = 600;

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
 * Studies WaniKani, as a deck: today's reviews, then, once they're done and the answers are sent and
 * the counts read again, today's lessons (the Apprentice limit is checked against that fresh count, so
 * the reviews just finished are counted). The two are separate sessions on screen but one flow: lessons
 * follow the reviews without a tap. Answers are typed or rated
 * (WaniKani's options), checked here, and sent to WaniKani as each item finishes, the latest held
 * back so it can be undone (src/wanikani/session.ts). WaniKani does the scheduling.
 */
export function WaniKaniReview({ wanikani, onDone, onOptions }: { wanikani: WaniKaniState; onDone: () => void; onOptions: () => void }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const { api, prefs, srs, send, seenDropped, skip, changeSynonym, synonymsWithPending } = wanikani;
  const [subjects, setSubjects] = useState<Map<number, Subject>>(new Map());
  const [synonyms, setSynonyms] = useState<Map<number, string[]>>(new Map());
  const [study, setStudy] = useState<Study | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  // Reviews and lessons are separate sessions: the lessons one follows the reviews on its own (see "from reviews into lessons").
  const [lessonsOnly, setLessonsOnly] = useState(false);
  const [kind, setKind] = useState<'reviews' | 'lessons'>('reviews');
  // What the lessons are, once this session is done: how many are offered, and whether the Apprentice limit holds them back.
  const [next, setNext] = useState<{ lessons: number; held: boolean; apprentice: number }>({ lessons: 0, held: false, apprentice: 0 });
  // The current question's state: the answer shown, what was typed, and how it was judged.
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  // An item marked to come back a few more times this session, by assignment id (src/core/miniCram.ts), and the
  // question it was last asked, which its returns ask again. Practice: nothing is sent to WaniKani or kept for undo.
  const cram = useMiniCram();
  const cramKind = useRef(new Map<string, QuestionKind>());
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
  // And when the app is left: the held answer is only in this screen's memory, so one closed from
  // the app switcher (or dropped by iOS in the background) lost it, and the item came back as a
  // review. Once it's sent it can't be undone, so leaving the app ends Undo for that answer.
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'background' || !studyRef.current?.held) return;
      const closed = studyFlush(studyRef.current);
      sendRef.current(closed.send);
      setStudy(closed.study);
    });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!api) return;
    let gone = false;
    setError(null);
    (async () => {
      try {
        const src = await source(api, wanikani);
        const { user, started, apprentice } = src;
        // Skipped words are left out of both, so a skipped word's lesson isn't offered either.
        const reviews = withoutSkipped(src.reviews, wanikani.skipped);
        const lessons = withoutSkipped(src.lessons, wanikani.skipped);
        // Reviews first; lessons only when none are up or they were asked for.
        const lessonKind = lessonsOnly || reviews.length === 0;
        const offered = lessonsToday(lessons.length, prefs.newPerDay, started);
        const lessonCount = lessonsToday(lessons.length, prefs.newPerDay, started, apprentice, prefs.maxApprentice);
        const held = lessonCount === 0 && offered > 0;
        // With the radicals and kanji they're made of, for the "Made of" row: one more batched read.
        const own = await src.subjects((lessonKind ? lessons : reviews).map((a) => a.subjectId));
        const read = new Map((await withComponents(own, src.subjects)).map((s) => [s.id, s]));
        const items = lessonKind ? sessionItems([], lessons, read, lessonCount) : sessionItems(reviews, [], read, 0);
        // The user's own synonyms count as right answers when typing; without them, only WaniKani's do.
        const typed: TypedKinds = { meaning: prefs.typeMeaning, reading: prefs.typeReading };
        const syn = typed.meaning ? await src.synonyms(items.map((i) => i.subjectId)).catch(() => new Map<number, string[]>()) : new Map<number, string[]>();
        if (gone) return;
        setSubjects(read);
        // Saved on this phone and not sent yet counts too.
        setSynonyms(new Map(items.map((i): [number, string[]] => [i.subjectId, synonymsWithPending(i.subjectId, syn.get(i.subjectId) ?? [])])));
        setCopySavedAt(src.savedAt ?? null);
        setKind(lessonKind ? 'lessons' : 'reviews');
        setNext({ lessons: lessonKind ? 0 : lessonCount, held, apprentice });
        setStudy(startStudy(buildSession(items, { mode: questionMode(typed, prefs.separate), lessonBatch: user.lessonBatch }), typed));
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
  // Capped: the keyboard comes up on every question, and its full slide made each new card feel slow.
  const keyboard = useKeyboardInset(KEYBOARD_SLIDE_MS);

  // One player for WaniKani's recordings, released when the screen closes. It reports to `sounding`,
  // which is how `wake` tells a word played right after another from one after a quiet stretch.
  const player = useRef<AudioPlayer | null>(null);
  const untrackPlayer = useRef<(() => void) | null>(null);
  useEffect(() => () => { untrackPlayer.current?.(); untrackPlayer.current = null; player.current?.remove(); player.current = null; }, []);
  const wake = useOutputWake();
  // Only the latest request plays: one still waiting on the headphones to wake gives way to a newer one.
  const playSeq = useRef(0);
  // The recording kept on this phone when there is one (offline.ts), else WaniKani's.
  const audioUrl = (s: Subject | undefined) => {
    const a = s && audioFor(s);
    return a ? localAudioUri(audioFileName(s.id, a)) ?? a.url : undefined;
  };
  const play = useCallback(async (url: string | undefined) => {
    if (!url) return;
    // Bluetooth headphones that have been quiet lose the start of the next sound, all of a word (useOutputWake).
    const mine = ++playSeq.current;
    await wake();
    if (mine !== playSeq.current) return;
    if (!player.current) {
      player.current = createAudioPlayer(null, { keepAudioSessionActive: true });
      untrackPlayer.current = trackPlayer(player.current);
    }
    player.current.replace({ uri: url });
    player.current.play();
  }, [wake]);

  const session = study?.session;
  const question = session ? currentQuestion(session) : undefined;
  const item = question && session ? session.items[question.assignmentId] : undefined;
  const subject = item ? subjects.get(item.subjectId) : undefined;
  const progress = question && session ? session.progress[question.assignmentId] : undefined;
  const left = session ? remaining(session) : { reviews: 0, lessons: 0 };

  // ==== from reviews into lessons ====
  // When the last review is answered: send what's held, read WaniKani again, and only then decide how many
  // lessons fit under the Apprentice limit. The counts the session was built from are from before these
  // reviews, so using them said "25 of 25" when the reviews had just moved items to Guru.
  const advancing = useRef<Study | null>(null);
  // Not the effect's own cleanup: replacing the study above re-runs the effect, which must not cancel this read.
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (!api || !study || question || kind !== 'reviews' || advancing.current === study) return;
    // The held answer goes now, so Undo ends for it: the study is replaced by the flushed one, which is not run again.
    const flushed = studyFlush(study);
    advancing.current = flushed.study;
    setStudy(flushed.study);
    (async () => {
      send(flushed.send);
      await wanikani.refresh(true);
      try {
        const src = await source(api, wanikani);
        const lessons = withoutSkipped(src.lessons, wanikani.skipped);
        const offered = lessonsToday(lessons.length, prefs.newPerDay, src.started);
        const count = lessonsToday(lessons.length, prefs.newPerDay, src.started, src.apprentice, prefs.maxApprentice);
        if (!mounted.current) return;
        setNext({ lessons: count, held: count === 0 && offered > 0, apprentice: src.apprentice });
        if (count > 0) setLessonsOnly(true);
      } catch {
        // Not reached: the done screen stays, and the next visit reads the counts again.
      }
      if (mounted.current) setAdvanced(true);
    })();
  }, [study, question, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const lesson = question?.kind === 'lesson';
  const asksMeaning = question?.kind === 'meaning' || question?.kind === 'both';
  const asksReading = question?.kind === 'reading' || question?.kind === 'both';
  // The answer side shows only what this question asked. An item's meaning and reading are separate
  // questions, and showing one's answer on the other's card gives that answer away when it comes up
  // (a missed question is asked again a few cards later), even if this item has already had it right.
  const showMeaning = lesson || (revealed && asksMeaning);
  const showReading = lesson || (revealed && asksReading);

  // A typed question keeps the keyboard up through its verdict and into the next typed question. It is
  // dismissed only by a question that isn't typed (Show answer), and comes back with the next typed one. The
  // new card is laid out before it does, so the card was tall, then shrank under the keyboard and its
  // centered content jumped up. For the moment before the keyboard shows, hold the height it had last time.
  const lastKeyboard = useRef(0);
  if (keyboard > 0) lastKeyboard.current = keyboard;
  const typedQuestion = !!question && !lesson && isTyped(study!.typed, question.kind);
  const questionKey = question && session ? `${question.assignmentId}:${question.kind}:${session.finished.length}` : '';
  const holdUntil = useRef(0);
  const heldKey = useRef('');
  if (questionKey !== heldKey.current) {
    heldKey.current = questionKey;
    holdUntil.current = typedQuestion ? Date.now() + KEYBOARD_HOLD_MS : 0;
  }
  const [, expireHold] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => expireHold((n) => n + 1), KEYBOARD_HOLD_MS + 20);
    return () => clearTimeout(t);
  }, [questionKey]);
  const holding = keyboard === 0 && typedQuestion && !revealed && Date.now() < holdUntil.current;
  const keyboardPad = Math.max(0, (keyboard > 0 ? keyboard : holding ? lastKeyboard.current : 0) - insets.bottom);

  // ==== keeping the keyboard up ====
  // One answer box serves every typed question, and anything that takes focus from it is undone: iOS drops the
  // keyboard when a box unmounts, when a sheet or alert opens over it, and when the screen is left and come back to.
  const answerBox = useRef<TextInputInstance>(null);
  // True while one of this screen's own sheets or alerts is open: focus is not pulled back until it closes.
  const modalOpen = useRef(false);
  const screenFocused = useRef(true);
  const wantsKeyboard = useRef(false);
  wantsKeyboard.current = typedQuestion;
  const refocus = useCallback(() => {
    requestAnimationFrame(() => {
      if (wantsKeyboard.current && screenFocused.current && !modalOpen.current) answerBox.current?.focus();
    });
  }, []);
  // A sheet that gives focus back when it closes, whichever button closed it. `onPick` returns false when the
  // pick leaves the screen or the app, which has nothing to focus.
  const showSheet = (config: Parameters<typeof ActionSheetIOS.showActionSheetWithOptions>[0], onPick: (i: number) => boolean | void) => {
    modalOpen.current = true;
    ActionSheetIOS.showActionSheetWithOptions(config, (i) => {
      modalOpen.current = false;
      if (onPick(i) !== false) refocus();
    });
  };
  useFocusEffect(useCallback(() => {
    screenFocused.current = true;
    refocus();
    return () => { screenFocused.current = false; };
  }, [refocus]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refocus(); });
    return () => sub.remove();
  }, [refocus]);
  // The next typed question starts empty in the same box, so any text the keyboard is still holding back goes too.
  useEffect(() => {
    answerBox.current?.clear();
    refocus();
  }, [questionKey, refocus]);

  // The mnemonics panel over the card; it belongs to one question, so every move to another closes it.
  const [panel, setPanel] = useState(false);
  const resetQuestion = () => {
    setPanel(false);
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
    // A marked item whose return is due comes up before the next question.
    const id = String(question.assignmentId);
    cramKind.current.set(id, question.kind);
    cram.answered(id, correct ? 3 : 1, !currentQuestion(r.study.session), cramUsable(r.study.session));
  };

  /** Whether a return may show this item: it's still in the session and its word is loaded. */
  const cramUsable = (sess: Session) => (id: string) => {
    const it = sess.items[Number(id)];
    return !!it && subjects.has(it.subjectId);
  };

  /** Missed it or Got it on a return: nothing is sent or scheduled, and it isn't in undo. */
  const answerReturn = (id: string, got: boolean) => {
    if (!study) return;
    haptic.answer();
    answerFlash.flash(got ? 3 : 1);
    cram.returned(id, got, !currentQuestion(study.session), cramUsable(study.session));
    resetQuestion();
  };

  const undo = () => {
    // A typed answer judged wrong and not yet counted (before Next) still counts as a miss.
    // Not from the session an answer was just given from (a tap landing before the screen has
    // drawn that answer): its held outcome has gone to WaniKani, and undoing from it would take
    // back the answer before, which can't be taken back.
    if (study && answeredFrom.current === study) return;
    const back = study && studyUndo(study, verdict?.result === 'wrong');
    if (!back) return;
    // Undoing the answer that saved a synonym takes the synonym back too.
    const saved = savedFrom.current;
    if (saved && back.session.queue === saved.queue) {
      savedFrom.current = null;
      changeSynonym({ subjectId: saved.subjectId, synonym: saved.synonym, remove: true });
      setSynonyms((m) => new Map(m).set(saved.subjectId, withPending(saved.subjectId, m.get(saved.subjectId) ?? [], [{ subjectId: saved.subjectId, synonym: saved.synonym, remove: true }])));
    }
    haptic.tap();
    cram.clearShowing();
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
    // Check stays tappable even when `typed` is empty: iOS can hold text from the Japanese keyboard back
    // until it's confirmed, so an empty `typed` doesn't mean an empty field. Say what to do instead of dimming.
    if (!typed.trim()) {
      setRetry(question.kind === 'reading' ? 'Type the reading, then press Check.' : 'Type the meaning, then press Check.');
      return;
    }
    const own = synonyms.get(subject.id) ?? [];
    const v = question.kind === 'reading' ? checkReading(subject, typed, own) : checkMeaning(subject, own, typed);
    if (v.result === 'retry') {
      // The right answer to the item's other question, typed in this box: that question counts as answered
      // when it is still waiting, and this one stays up.
      if (study && v.credit && canCredit(study.session, v.credit)) {
        setStudy(studyCredit(study, v.credit));
        setTyped('');
        setRetry(v.credit === 'reading' ? 'Counted as the reading. Now type the meaning.' : 'Counted as the meaning. Now type the reading.');
        return;
      }
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
  // The save counts at once here and is sent when WaniKani can be reached (useWaniKani's `changeSynonym`).
  // `savedFrom` is the queue the saving answer was given from, so undoing that answer takes the synonym back.
  const savedFrom = useRef<{ queue: Study['session']['queue']; subjectId: number; synonym: string } | null>(null);
  const notRight = () => {
    if (!study || !question || !subject) return;
    const text = typed.trim();
    const canSave = canSaveMeaning(question) && !!text;
    // The answer is already shown as wrong but not counted yet, so it can be put back in the pile to decide later.
    const options = ['Count as right', ...(canSave ? ['Save as a correct meaning'] : []), ...(canAskLater(study.session) ? ['Ask later'] : []), 'Cancel'];
    showSheet({ title: text ? `You typed "${text}". Count it as right?` : 'Count it as right?', options, cancelButtonIndex: options.length - 1 }, (i) => {
      const picked = options[i];
      if (picked === 'Count as right') answer(true);
      if (picked === 'Ask later') {
        if (studyRef.current !== study) return;
        later();
        checkPopup.current = null;
        popups.hideAll();
      }
      if (picked !== 'Save as a correct meaning') return;
      // The screen may have moved on while the sheet was open: only this question is marked correct.
      if (studyRef.current !== study) return;
      savedFrom.current = { queue: study.session.queue, subjectId: subject.id, synonym: text };
      changeSynonym({ subjectId: subject.id, synonym: text });
      setSynonyms((m) => new Map(m).set(subject.id, [...(m.get(subject.id) ?? []), text]));
      answer(true);
    });
  };

  // The word is left out of this session and every later one, as a lesson or a review; WaniKani still has it, and the options list it to bring it back.
  const confirmSkip = () => {
    if (!study || !question || !subject) return;
    const assignmentId = question.assignmentId;
    const isLesson = !!study.session.items[assignmentId]?.lesson;
    const word = subject;
    const name = word.characters ?? word.meanings[0]?.meaning ?? 'this word';
    modalOpen.current = true;
    const closeAlert = () => { modalOpen.current = false; refocus(); };
    Alert.alert(
      `Skip ${name} for good?`,
      "It won't come up in lessons or reviews on this iPhone again. WaniKani still lists it, so it stays on wanikani.com. You can bring it back in WaniKani's options.",
      [
        { text: 'Cancel', style: 'cancel', onPress: closeAlert },
        {
          text: 'Skip',
          style: 'destructive',
          onPress: () => {
            // Only a question of this word is cleared: the screen may have moved on while the alert was open.
            const onIt = studyRef.current && currentQuestion(studyRef.current.session)?.assignmentId === assignmentId;
            skip(word, assignmentId, isLesson);
            setStudy((s) => (s ? dropItem(s, assignmentId) : s));
            if (onIt) resetQuestion();
            checkPopup.current = null;
            popups.hideAll();
            closeAlert();
          },
        },
      ],
      { onDismiss: closeAlert },
    );
  };

  const title = 'WaniKani';
  // With the keyboard up the card has about 230pt for its content, so the screen gives it the room the
  // count takes: the count moves into the title and the progress bar sits right over the card.
  const compact = keyboardPad > 0;
  const countTitle = `${title} · ${kind === 'reviews' ? `${left.reviews} left` : `${left.lessons} new`}`;
  const countRow = compact ? null : (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
      {kind === 'reviews' ? <Count value={left.reviews} label="remaining" color={c.countDue} /> : <Count value={left.lessons} label="new" color={c.countNew} />}
    </View>
  );
  const cardTop = compact ? space.l : space.xxl;
  // Only before the question is answered or its answer is shown, so it can't be used to dodge a miss.
  const askable = !!session && canAskLater(session) && !verdict && !revealed;
  const menu = useMemo(() => (subject ? () => {
    const skippable = canSkip(subject) && !!question;
    const id = question && !lesson ? String(question.assignmentId) : undefined;
    const marked = id ? !!cram.entry(id) : false;
    const options = [...(askable ? ['Ask later'] : []), ...(id ? [marked ? 'Stop cramming this word' : 'Cram this word'] : []), ...(skippable ? ['Skip this word for good'] : []), 'Open on wanikani.com', 'WaniKani options', 'Cancel'];
    showSheet({ options, cancelButtonIndex: options.length - 1 }, (i) => {
      const picked = options[i];
      if (picked === 'Ask later') later();
      if (picked === 'Cram this word' || picked === 'Stop cramming this word') {
        if (!id || !question || !progress) return;
        cramKind.current.set(id, question.kind);
        cram.toggle(id, progress.meaning || progress.reading || progress.wrongMeaning > 0 || progress.wrongReading > 0);
      }
      if (picked === 'Skip this word for good') confirmSkip();
      if (picked === 'Open on wanikani.com' && subject.url) Linking.openURL(subject.url).catch(() => undefined);
      if (picked === 'WaniKani options') onOptions();
      return picked !== 'Open on wanikani.com' && picked !== 'WaniKani options';
    });
  } : undefined), [subject, onOptions, askable, study, lesson, question, cram.entry]); // eslint-disable-line react-hooks/exhaustive-deps
  const toolbar = (
    <Stack.Toolbar placement="right">
      {study && canUndo(study) ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel="Undo the last answer" onPress={undo} /> : null}
      {menu ? <Stack.Toolbar.Button icon="ellipsis.circle" accessibilityLabel="More: ask later, cram this word, skip this word, open on wanikani.com or WaniKani's options" onPress={menu} /> : null}
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
        <Loading error={error} onRetry={() => setLoads((n) => n + 1)} />
      </Screen>
    );
  }

  // A mini cram return takes the screen before the next question, or the end of the session.
  const returnItem = cram.showing ? study.session.items[Number(cram.showing)] : undefined;
  const returnSubject = returnItem ? subjects.get(returnItem.subjectId) : undefined;
  if (cram.showing && returnItem && returnSubject) {
    const id = cram.showing;
    const asked = cramKind.current.get(id) ?? 'meaning';
    const showM = revealed && (asked === 'meaning' || asked === 'both');
    const showR = revealed && (asked === 'reading' || asked === 'both');
    const returnMenu = () => {
      const options = ['Stop cramming this word', 'Open on wanikani.com', 'WaniKani options', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (i) => {
        const picked = options[i];
        if (picked === 'Stop cramming this word') { cram.toggle(id, true); resetQuestion(); }
        if (picked === 'Open on wanikani.com' && returnSubject.url) Linking.openURL(returnSubject.url).catch(() => undefined);
        if (picked === 'WaniKani options') onOptions();
      });
    };
    const returnToolbar = (
      <Stack.Toolbar placement="right">
        {canUndo(study) ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel="Undo the last answer" onPress={undo} /> : null}
        <Stack.Toolbar.Button icon="ellipsis.circle" accessibilityLabel="More: stop cramming this word, open on wanikani.com or WaniKani's options" onPress={returnMenu} />
      </Stack.Toolbar>
    );
    const revealReturn = () => { Keyboard.dismiss(); setRevealed(true); if (prefs.autoplay && (asked === 'reading' || asked === 'both')) play(audioUrl(returnSubject)); };
    const returnFooter = revealed ? (
      <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
        <RateButton label="Missed it" detail="Extra pass" color={c.again} onPress={() => answerReturn(id, false)} />
        <RateButton label="Got it" detail="Extra pass" color={c.good} onPress={() => answerReturn(id, true)} />
      </Reveal>
    ) : <Button label="Show answer" onPress={revealReturn} />;
    return (
      <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top, paddingBottom: keyboardPad }}>
        <Screen title={compact ? countTitle : title} largeTitle={false} toolbar={returnToolbar} footer={returnFooter}>
          {countRow}
          <ProgressBar value={sessionProgress(study.session)} style={{ marginHorizontal: space.l, marginTop: space.s }} />
          {/* Tapping the card shows the answer. Not an accessibility element itself: Show answer is the control VoiceOver uses. */}
          <Pressable accessible={false} disabled={revealed} onPress={() => { haptic.select(); revealReturn(); }} style={{ flex: 1 }}>
          <CardSurface color={subjectColor(c, returnSubject.type)} top={cardTop}>
            <CardContent
              subject={returnSubject}
              label={`${SUBJECT_TYPE_NAMES[returnSubject.type]} · Level ${returnSubject.level}`}
              parts={madeOf(returnSubject, subjects)}
              showMeaning={showM}
              showReading={showR}
              synonyms={synonyms.get(returnSubject.id) ?? []}
              lesson={false}
              compact={compact}
              contentKey={`${id}:${cram.returnsAnswered}`}
            />
            <QuestionBand kind={asked === 'lesson' ? 'both' : asked} />
            {answerFlash.overlay}
          </CardSurface>
          </Pressable>
        </Screen>
      </View>
    );
  }

  if (!question || !item || !subject) {
    const done = study.session.finished.length;
    // While the counts are read again for the lessons that follow, there is nothing to tap.
    const checking = kind === 'reviews' && !advanced;
    const footer = checking ? undefined : <Button label="Back to decks" onPress={onDone} />;
    return (
      <Screen title={title} largeTitle={false} toolbar={toolbar} footer={footer}>
        <Reveal style={{ flex: 1 }}>
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, flexGrow: 1, alignItems: 'center', gap: space.s, padding: space.xl }}>
          <Icon name="checkmark.circle.fill" size={56} color={c.countDue} weight="regular" />
          <Text style={{ ...type.title, color: c.text, textAlign: 'center', marginTop: space.s }}>{kind === 'lessons' ? 'Lessons done' : 'Reviews done'}</Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {done ? `${done} ${done === 1 ? 'item' : 'items'} this session` : 'Nothing due right now'}
          </Text>
          {droppedNote()}
          {next.held && prefs.maxApprentice !== null ? <LessonsPausedNote apprentice={next.apprentice} limit={prefs.maxApprentice} /> : null}
          <WaniKaniMissList missed={missedItems(study.session)} subjects={subjects} />
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
  let tapToShow = false;
  if (lesson) {
    // The last lesson of a batch leads into its quiz.
    footer = <Button label={study.session.queue[1]?.kind === 'lesson' ? 'Next' : 'Start the quiz'} onPress={() => answer(true)} />;
  } else if (isTyped(study.typed, question.kind)) {
    const result = verdict?.result;
    footer = (
      <>
        {retry ? <Text style={{ ...type.subhead, color: c.warning, textAlign: 'center' }}>{retry}</Text> : null}
        {verdict?.result === 'correct' && verdict.close ? <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Close enough: check the spelling.</Text> : null}
        <View>
        <TextInput
          ref={answerBox}
          value={typed}
          onChangeText={(t) => { if (!verdict) setTyped(question.kind === 'reading' ? toKana(t) : t); }}
          // Still editable once judged so the keyboard stays up for the whole session: the text is held
          // (onChangeText ignores it) and the caret hidden, and return goes to the next question. The same
          // box serves every typed question (no `key`, which unmounted it and dropped the keyboard on each
          // answer), and a blur that isn't one of our own sheets opening takes focus straight back.
          caretHidden={!!verdict}
          onBlur={() => { if (!modalOpen.current) refocus(); }}
          onSubmitEditing={check}
          submitBehavior="submit"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          placeholder={question.kind === 'reading' ? 'Reading' : 'Meaning'}
          accessibilityLabel={question.kind === 'reading' ? 'Type the reading' : 'Type the meaning'}
          placeholderTextColor={result ? c.onRating : c.textTertiary}
          selectionColor={c.accent}
          keyboardAppearance={dark ? 'dark' : 'light'}
          style={{
            ...type.body, textAlign: 'center', ...smooth, borderRadius: radius.m, borderWidth: hairline, minHeight: MIN_TAP,
            paddingHorizontal: space.m + (result === 'wrong' && canMarkCorrect(question) ? MIN_TAP - space.s : 0), paddingVertical: space.s,
            color: result ? c.onRating : c.text,
            backgroundColor: result === 'correct' ? c.good : result === 'wrong' ? c.again : c.surface,
            borderColor: result ? 'transparent' : c.border,
          }}
        />
        {/* A wrong answer can be counted right (a typo, a slip of the keys): a round button at the box's end opens the choices. */}
        {result === 'wrong' && canMarkCorrect(question) ? (
          <Tappable
            onPress={notRight}
            accessibilityRole="button"
            accessibilityLabel="Count my answer as right"
            scaleTo={0.92}
            style={{ position: 'absolute', right: space.xs, top: 0, bottom: 0, width: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.wkLine }}>
              <Icon name="ellipsis" size={18} color={c.onRating} weight="bold" />
            </View>
          </Tappable>
        ) : null}
        </View>
        <Button
          label={!verdict ? 'Check' : finishes || result === 'wrong' ? 'Next' : 'Next question'}
          onPress={check}
        />
      </>
    );
  } else if (!revealed) {
    footer = <Button label="Show answer" onPress={reveal} />;
    tapToShow = true;
  } else {
    footer = (
      <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
        <RateButton label="Again" detail={againDetail} color={c.again} onPress={() => answer(false)} />
        <RateButton
          label="Good"
          detail={finishes ? outcomeText(nextStage(item.srsStage, wrong, system), system) : question.kind === 'meaning' ? 'Then the reading' : 'Then the meaning'}
          color={c.good}
          onPress={() => answer(true)}
        />
      </Reveal>
    );
  }

  const slots = stackSlots(popups.stack);
  return (
    <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top, paddingBottom: keyboardPad }}>
      <Screen title={compact ? countTitle : title} largeTitle={false} toolbar={toolbar} footer={footer}>
        {countRow}
        {copySavedAt || wanikani.offline ? (
          <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
            {`${copySavedAt ? `${offlineText(copySavedAt, new Date(), wanikani.dayStartsAtHour)}.` : 'Offline.'} Answers are sent when WaniKani can be reached.`}
          </Text>
        ) : null}
        {droppedNote()}
        <ProgressBar value={sessionProgress(study.session)} style={{ marginHorizontal: space.l, marginTop: space.s }} />
        {/* Tapping the card shows the answer where the footer says Show answer (not a typed question, a lesson or the rating step). Not an accessibility element itself: Show answer is the control VoiceOver uses. */}
        <Pressable accessible={false} disabled={!tapToShow} onPress={() => { haptic.select(); reveal(); }} style={{ flex: 1 }}>
        <CardSurface color={subjectColor(c, subject.type)} top={cardTop}>
          <CardContent
            subject={subject}
            label={label}
            parts={madeOf(subject, subjects)}
            showMeaning={showMeaning}
            showReading={showReading}
            synonyms={synonyms.get(subject.id) ?? []}
            lesson={lesson}
            compact={compact}
            contentKey={`${subject.id}:${question.kind}`}
          />
          {/* What's asked, at the card's foot beside the answer: light for the meaning, dark for the reading. */}
          {/* The stage popup hangs off this view's top edge: just above the band, or the card's foot in a lesson. */}
          <View>
            {question.kind !== 'lesson' ? <QuestionBand kind={question.kind} /> : null}
            {popups.stack.map((e, i) => <StagePopup key={e.id} change={e.change} slot={slots[i]} animate={prefs.stageAnimation} hold={keyboardPad} />)}
          </View>
          {/* In the card's corner, not in its flow, so the answer keeps the height. Play is the reading's, as before. */}
          {showMeaning || showReading ? (
            <CardTools
              onPlay={showReading && audioUrl(subject) ? () => { haptic.tap(); play(audioUrl(subject)); } : undefined}
              onMnemonics={!lesson && hasMnemonicPanel(subject, showMeaning, showReading) ? () => { haptic.tap(); setPanel(true); } : undefined}
            />
          ) : null}
          {panel ? <MnemonicsPanel subject={subject} showMeaning={showMeaning} showReading={showReading} onClose={() => setPanel(false)} /> : null}
          {answerFlash.overlay}
        </CardSurface>
        </Pressable>
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
      style={{ flex: 1, minHeight: 60, borderRadius: radius.m + 2, ...smooth, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: color }}
    >
      <Text style={{ ...type.caption, color: c.onRating }}>{detail}</Text>
      <Text style={{ ...type.headline, color: c.onRating }}>{label}</Text>
    </Tappable>
  );
}
