import { Stack, usePreventRemove } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SFSymbol } from 'expo-symbols';
import { ActivityIndicator, Alert, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, type Api, type GrammarChoice, type Language, type Length, type PastText, type ReaderText, type Settings, type StoryCharacter, type TextGrammar, type TextStage, type Word } from '../../reader/api';
import { countOutsideDeck, isName, isOutsideDeck, underFloor } from '../../reader/deckWords';
import { marksIn, withMark, type HideableMark, type Mark } from '../../reader/marks';
import { lineSide, scrollTarget, type Box } from '../../reader/follow';
import { saidAs } from '../../reader/wordAudio';
import { helperNote } from '../../reader/formPrimer';
import { TEXT_SIZES, TEXT_SIZE_LABELS, THAI_FONTS, THAI_FONT_LABELS, readFont, scaledFontSize, type TextSize, type ThaiFont } from '../../reader/fonts';
import { COMMON_WORD_STATUS, LANGUAGES, inDeck, wordStatus } from '../../reader/languages';
import { wordFrequency } from '../../reader/frequency';
import { firstLine, LOOP_BREAK_NOTE, paragraphs, rangeOf, repeatBadge } from '../../reader/playback';
import { isSlow, RATES, SLOW_RATE } from '../../reader/playbackRate';
import { nextInOrder, playOrder, stepLength, upNextOrder, type LengthStep } from '../../reader/shelf';
import { answerQuiz, formatDuration, heard, isFlagged, listenedOnly, lookUp, startSession, toggleFlag, toLog, type Session } from '../../reader/session';
import { phraseRange, phrasePart, phraseText, type PhrasePick } from '../../reader/phrase';
import { choicesView, holdsPlayAll } from '../../reader/choices';
import { buildCheck, loggedScore, type CheckPicks, type CheckQuestion } from '../../reader/check';
import { tapMode, type TapMode } from '../../reader/guess';
import { allHeard, listensFirst, listensNeeded } from '../../reader/listenFirst';
import { prefs, savePrefs } from '../../reader/storage';
import { wrapGroups } from '../../reader/wordLayout';
import { haptic } from '../haptics';
import { ReadRecap } from './ReadRecap';
import { Pop, Reveal } from '../motion';
import { LineExplanation } from './ReaderExplain';
import { RegisterChip } from './ReaderNatural';
import { ReadWordTitle } from './ReadWordTitle';
import { ReadGlossLine } from './ReadWordTips';
import { LoopTextIcon, RepeatLineIcon, StartOverIcon } from './PlayerIcons';
import { ReaderJumpToLine } from './ReaderJumpToLine';
import { PhraseExplanation, type PhraseAnchor, type PhraseMining } from './ReaderPhrase';
import { ReadChoices } from './ReadChoices';
import { CheckCard, ReaderCheck } from './ReaderCheck';
import { LineDrillCard, ReadLineDrill } from './ReadLineDrill';
import { ReadRetell } from './ReadRetell';
import type { LineDrillKind } from '../../reader/lineDrill';
import { usePhraseDrag } from './usePhraseDrag';
import { ReadGrammarDial } from './ReadGrammarDial';
import { ReadGrammarNote } from './ReadGrammarNote';
import { ReadFormChip, ReadFormSheet } from './ReadFormSheet';
import { ReaderFormQuiz } from './ReaderFormQuiz';
import { useFormQuiz } from './useFormQuiz';
import { ReadFrequency } from './ReadFrequency';
import { ReadKanji } from './ReadKanji';
import { GuessPrompt, QuizChoices, rightAnswer } from './ReadWordGuess';
import { PracticeWordPill, TintPill } from './PracticeWordPill';
import { WordView } from './ReadWord';
import { ReaderKey } from './ReaderKey';
import { ReaderXray } from './ReaderXray';
import { characterOfWord, firstSeen } from '../../reader/xray';
import { WordActionGroup, WordActionRow, WordPlayButton } from './ReadWordActions';
import { Speaker, speakerSize } from './ReadSpeaker';
import { useLinePlayback } from './useLinePlayback';
import { useConnectionProblem } from '../connection';
import { idleRecording, RecordIconButton, RecordYourself } from '../RecordYourself';
import type { SelfRecording } from '../useSelfRecording';
import { recordExtraRead } from '../../tools/extrasStorage';
import type { ReaderPlayerHost } from '../useReaderPlayer';
import { Button, Card, ErrorNote, HeaderAction, Help, Icon, Screen, Segments, Tappable } from '../kit';
import { MakingCard } from '../MakingCard';
import { textSteps } from '../../reader/making';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme, readable } from '../theme';

/**
 * The reader: a text split into words by the server, a gloss on tap, audio line by line, and a
 * check after it (docs/read-and-listen/architecture.md, Client). Nothing here answers a card.
 *
 * Layout: the title, practice words, the lines (each with
 * a "Show translation" link that shows that line's English alone under its words, its own replay button, and an explain button
 * that opens Claude's note on its grammar and vocabulary under it), then Done, with
 * the player pinned under the scroll view. Done swaps the lines for the end view (the check, stats,
 * words marked unknown). The gloss popover is a transparent Modal, so a tap's page coordinates
 * place it directly.
 *
 * Reading options (Show English, Paragraphs, Thai letters) are one header menu, so the text
 * starts right under the practice words. The key to the marks on words, with a switch for each, is a
 * sheet that a button beside that menu opens (ReaderKey.tsx).
 *
 * From the shelf: a text already written opens straight away, and the end view steers the next
 * ones (length, more or fewer like this) and offers the next text on the shelf. Play all plays the
 * shelf's texts one after another, logging each as read once its last line has played.
 *
 * Reading again: a past text opens here with nothing logged (no Done, no marking words unknown),
 * since a second reading isn't recorded. It can be played with the text hidden straight away.
 *
 * Listen only: the end view offers to play a finished text again with the text hidden (brief,
 * design principle 6). The lines show who's speaking instead, and Show the text
 * brings the words back. The reading is logged as listen-only.
 *
 * A story written with paragraph marks reads as continuous text (`paragraphs`): a gap between
 * paragraphs, no per-line rows or buttons, the playing line shaded, and previous/next line in the
 * player. English then comes only from Show English. The Paragraphs option (shown only for such a
 * story, kept in prefs) turns it off for a row per line, as for every other text.
 *
 * Audio (useLinePlayback.ts): one player is reused for every line. Play runs the text from the current line to the end
 * (`nextLine`), and round again from the first line with Loop text on (only its first pass counts as the
 * text played through); Start over plays from the first line; a line's replay button plays that line alone. Speed is Slow or Normal, and
 * Slow is its own recording spoken slowly by Azure (`startLine`), not the player stretching the
 * normal one. The audio session stays active between
 * lines (`keepAudioSessionActive`), or iOS can suspend the app in the gap with the screen locked,
 * and plays in the background while this screen is open. A line that fails to load counts as
 * finished, so Play moves on. When the playing line changes, the text scrolls to it if it's out of
 * view (`scrollTarget`).
 *
 * Loading: `/next` answers 202 while the server writes a text, so `load` asks again every few
 * seconds. `loadId` and `mounted` make a load that's been superseded (Next, then Back) drop its result.
 */

/** A tapped word and where, with how its meaning is held back (`guess`, reader/guess.ts), none to show it at once. */
export type Tapped = { word: Word; x: number; y: number; guess?: TapMode };

const POLL_MS = 3_000;
// Three attempts and the audio rarely take more than two minutes; past this, something is wrong.
const WRITE_WAIT_MS = 4 * 60_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// How long Play all waits on the server between two texts. iOS can drop a connection while the app
// is in the background, and a request that never answers would leave Play all stuck for good.
const BETWEEN_TEXTS_MS = 15_000;
const within = <T,>(work: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out')), ms);
  work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

/**
 * A text from the shelf (`order`: the shelf's texts as they were listed, for Next; `playAll`: play
 * them one after another), a new text on a topic (practicing `words` when given, the cards just
 * studied), or a past text to read again.
 */
export type ReaderSource =
  | { kind: 'shelf'; textId: number; order: number[]; playAll?: boolean }
  | { kind: 'topic'; topic: { id: number; name: string }; words?: string[] }
  // `listen`: heard through with the words hidden, starting now, and counted as a listen on the
  // server (relisten.py); it holds the texts to play after this one, none when this is the last.
  | { kind: 'past'; text: PastText; listen?: PastText[] };

type UpNext = { id: number; title: string; lines: number; order: number[] };

export function Reader({ api, playerHost, source, settings, onSettings, onPlayWord, onNext, onDone, onOpenGrammar, mining }: {
  api: Api;
  /** The shared audio player, which keeps playing on the tab bar when this is closed on Play all (useReaderPlayer). */
  playerHost: ReaderPlayerHost;
  source: ReaderSource;
  /** Opens a grammar point's page, from a line's explanation. */
  onOpenGrammar: (id: string) => void;
  /** Adding a selected phrase to the deck through the note editor; missing when there's no deck to add to. */
  mining?: PhraseMining;
  /** Plays a tapped word: its deck recording, else the phone's voice (useWordAudio). */
  onPlayWord: (word: string, language: Language, say?: string) => void;
  /** Read & Listen's settings, for the length new texts are written at; null until loaded. */
  settings: Settings | null;
  onSettings: (settings: Settings) => void;
  /** Opens another shelf text in this reader (Next, and Play all moving on). */
  onNext: (source: ReaderSource) => void;
  onDone: () => void;
}) {
  const review = source.kind === 'past';
  const c = useTheme();
  const [text, setText] = useState<ReaderText | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [english, setEnglish] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [xrayOpen, setXrayOpen] = useState(false);
  // Lines whose English was shown on their own, while Show English is off.
  const [lineEnglish, setLineEnglish] = useState<number[]>([]);
  // Lines whose explanation is open (each asks the server when it opens; the server keeps the answer).
  const [explained, setExplained] = useState<number[]>([]);
  const [listenOnly, setListenOnly] = useState(false);
  const [highlight, setHighlight] = useState(prefs().highlight);
  const [markNames, setMarkNames] = useState(prefs().markNames);
  const [hiddenMarks, setHiddenMarks] = useState(prefs().hiddenMarks);
  const [paragraphMode, setParagraphMode] = useState(prefs().paragraphs);
  const [thaiFont, setThaiFont] = useState(prefs().thaiFont);
  const [textSize, setTextSize] = useState(prefs().textSize);
  // The fill-in slots on a few known words (reader/formQuiz.ts), and whether they're shown.
  const [formQuizOn, setFormQuizOn] = useState(prefs().formQuiz);
  const quiz = useFormQuiz(text, formQuizOn);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  // A phrase being selected (its last word not reached yet) or selected, explained beside it; it can run over several lines.
  const [phrase, setPhrase] = useState<PhrasePick | null>(null);
  // Grammar points marked from the popover while reading, by id (ReadGrammarNote).
  const [grammarChosen, setGrammarChosen] = useState<Record<string, GrammarChoice>>({});
  const chooseGrammar = (id: string, state: GrammarChoice) => setGrammarChosen((prev) => ({ ...prev, [id]: state }));
  const [ended, setEnded] = useState(false);
  // The check after reading (ReaderCheck): its questions, built at Done; what was picked for each,
  // null until it's started; and whether it's showing in place of the end view.
  const [check, setCheck] = useState<CheckQuestion[]>([]);
  const [checkPicks, setCheckPicks] = useState<CheckPicks | null>(null);
  const [checking, setChecking] = useState(false);
  // Say it back or Write what you hear (ReadLineDrill), or Retell it (ReadRetell), in place of the end view while it runs.
  const [drilling, setDrilling] = useState<LineDrillKind | 'retell' | null>(null);
  // Which way the screen is being left while the reading is logged, for that button's spinner.
  const [leaving, setLeaving] = useState<'next' | 'back' | null>(null);
  const [writing, setWriting] = useState(false);
  // Where the server has got to in writing the text asked for, for the making card.
  const [writeStage, setWriteStage] = useState<TextStage | undefined>(undefined);
  // Offline the text and its audio come from the phone, and the reading is held to send later
  // (reader/offlineApi.ts); what needs the server is left out of the end view.
  const problem = useConnectionProblem();
  const [lengthStep, setLengthStep] = useState<LengthStep>('same');
  const [steerError, setSteerError] = useState<string | null>(null);
  // A story episode's pick for what happens next (an index into text.choices), and why saving it failed.
  const [chosen, setChosen] = useState<number | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const choiceSeq = useRef(0);
  // The length new texts were written at when this text opened, so Shorter and Longer step from it.
  const baseLength = useRef<Length>(settings?.lines ?? 8);
  const autoPlayed = useRef(false);
  // The past text in view has been counted as heard again (heardThrough), once however it ends.
  const listenLogged = useRef(false);
  // Listen before reading (reader/listenFirst.ts): the words stay hidden until every line has played
  // to its end, once or twice (`listenGate` is how many times: 0 when the words show). `heardLines`
  // is how many times each line has, in this text.
  const [listenGate, setListenGate] = useState<0 | 1 | 2>(0);
  const heardLines = useRef(new Map<number, number>());
  const logged = useRef(false);
  const mounted = useRef(true);
  const loadId = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  // The audio, line by line (useLinePlayback.ts): this screen counts what's heard and moves on.
  const { player, status, sounding, current, shaded, rate, slowOffered, repeat, played, loopText, breaking, silentLine, self, spoken, playLine, skip, togglePlay, changeRate, cycleRepeat, toggleLoop, startOver, reset: resetPlayback } = useLinePlayback({
    api,
    playerHost,
    text,
    onPlay: (r) => setSession((s) => (s ? heard(s, r) : s)),
    onLineHeard: (line) => markHeard(line),
    onPlayedThrough: (looping) => {
      if (!text) return;
      // Play all: the whole text has played, so it counts as read; on to the next one, unless Loop text
      // is on (it goes round this text again, and only that first pass reaches here).
      // An episode that ends on a choice holds Play all, so the choice isn't skipped past.
      if (!looping && source.kind === 'shelf' && source.playAll && !listenOnly && !holdsPlayAll(text, review)) playNext();
      // A past text played through with its words hidden counts as heard again.
      if (review && listenOnly) heardThrough();
    },
  });

  // A story's paragraphs (`marked` is null for a dialogue, or a story written before paragraphs):
  // read as continuous text with no buttons of their own, while the Paragraphs switch is on.
  // Everything else is a row per line.
  const marked = text ? paragraphs(text.lines) : null;
  const paras = paragraphMode ? marked : null;
  // The marks this text uses, for the key. Marking a word unknown changes the session, so it's read again then.
  const keyMarks = useMemo(() => (text ? marksIn(text, (w) => (session ? isFlagged(session, w) : false)) : []), [text, session]);

  const scroller = useRef<ScrollViewInstance>(null);
  const lineBoxes = useRef<Box[]>([]);
  // Null until the first scroll: the view opens at the top, which is at minus the header's overlap.
  const scrollY = useRef<number | null>(null);
  const viewHeight = useRef(0);
  // How far down the window the scroll view's frame starts. The header covers the part of the frame
  // above `headerHeight`, which iOS insets the content by, so a line followed to has to land below it.
  const viewTop = useRef(0);
  const headerHeight = useHeaderHeight();

  // Which way the current line lies from what's on screen, for the button that scrolls back to it.
  const [lineOff, setLineOff] = useState<'above' | 'below' | null>(null);
  const currentBox = () => {
    const at = current === null ? -1 : paras ? rangeOf(paras, current) : current;
    return at < 0 ? undefined : lineBoxes.current[at];
  };
  const frame = () => ({ height: viewHeight.current, insetTop: Math.max(0, headerHeight - viewTop.current) });
  const updateLineOff = () => {
    const box = currentBox();
    const side = listenOnly || !box || !viewHeight.current ? null : lineSide(box, scrollY.current ?? -frame().insetTop, frame());
    setLineOff((prev) => (prev === side ? prev : side));
  };
  const followCurrent = () => {
    const box = currentBox();
    if (!box || !viewHeight.current) return;
    const y = scrollTarget(box, scrollY.current ?? -frame().insetTop, frame());
    if (y !== null) scroller.current?.scrollTo({ y, animated: true });
  };

  useEffect(() => {
    // Listening without the text there's nothing to follow: the rows are only labels.
    if (listenOnly) return;
    followCurrent();
    updateLineOff();
  }, [current]);

  const load = async () => {
    const id = ++loadId.current;
    const stillWanted = () => mounted.current && id === loadId.current;
    resetPlayback();
    setText(null);
    setError(null);
    setEnded(false);
    setCheck([]);
    setCheckPicks(null);
    setChecking(false);
    setDrilling(null);
    setWriting(false);
    setWriteStage(undefined);
    setLineEnglish([]);
    // The next text is a different one: an explanation left open would ask the server for the
    // same line of it, and a gloss would sit over a word that's gone.
    setExplained([]);
    setTapped(null);
    setPhrase(null);
    setListenOnly(false);
    setLengthStep('same');
    setSteerError(null);
    setChosen(null);
    setChoiceError(null);
    choiceSeq.current++;
    autoPlayed.current = false;
    listenLogged.current = false;
    heardLines.current = new Map();
    setListenGate(0);
    baseLength.current = settings?.lines ?? 8;
    lineBoxes.current = [];
    scrollY.current = null; // back at the top, which is at minus the header's overlap
    logged.current = false;
    try {
      if (source.kind === 'past' || source.kind === 'shelf') {
        const opened = await api.text(source.kind === 'past' ? source.text.id : source.textId);
        if (!stillWanted()) return;
        setText(opened);
        setChosen(opened.chosen ?? null);
        setSession(startSession(opened, Date.now()));
        return;
      }
      const topicId = source.topic.id;
      const deadline = Date.now() + WRITE_WAIT_MS;
      const words = source.words;
      let next = await api.nextText(topicId, words, setWriteStage);
      while (next === null) {
        if (!stillWanted()) return;
        setWriting(true);
        if (Date.now() > deadline) throw new ApiError('Writing this text is taking longer than usual. Try again in a minute.', 0);
        await wait(POLL_MS);
        if (!stillWanted()) return;
        next = await api.nextText(topicId, words, setWriteStage);
      }
      if (!stillWanted()) return;
      setText(next);
      setSession(startSession(next, Date.now()));
    } catch (e) {
      if (stillWanted()) setError(e instanceof ApiError ? e.message : "Couldn't get a text. Try again.");
    }
  };

  // The word popover and the phrase popup are Modals. A Modal closed while the app is in the
  // background (Play all moving on to the next text) can stay on screen as an invisible layer that
  // takes every tap, so they're closed on the way out instead.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      setTapped(null);
      setPhrase(null);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => { load(); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps -- loads once per source

  // A line has played to its end (or has no sound): once every line has, the words appear.
  const markHeard = (line: number) => {
    if (!listenGate || !text) return;
    heardLines.current.set(line, (heardLines.current.get(line) ?? 0) + 1);
    if (allHeard(text.lines, heardLines.current, listenGate)) showText();
  };

  const showText = () => {
    setListenGate(0);
    setListenOnly(false);
    scrollY.current = null; // the lines' scroll view is mounted fresh, at the top
  };

  // A new text opens with its words hidden, with the setting on.
  useEffect(() => {
    if (!text || !listensFirst(prefs().listenFirst, source.kind, source.kind === 'shelf' && !!source.playAll, firstLine(text.lines) !== null)) return;
    setListenGate(listensNeeded(prefs().listenTwice));
    setListenOnly(true);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps -- once per text

  // A past text played through with the words hidden counts as heard again (relisten.py), however
  // it was started: the listen-again card, a Past texts row's button, or the text's own button. A
  // listen-again run then moves on to its next text, in place, so Back still returns where it began.
  const heardThrough = async () => {
    if (!text || source.kind !== 'past' || listenLogged.current) return;
    listenLogged.current = true;
    try {
      await api.logListen(text.id);
    } catch {
      // Not counted: it's offered again, which is the better way to be wrong.
    }
    const [next, ...rest] = source.listen ?? [];
    if (next && mounted.current) onNext({ kind: 'past', text: next, listen: rest });
  };

  // Play all, and a listen-again run, start each text playing as soon as it's open.
  useEffect(() => {
    if (!text || autoPlayed.current) return;
    if (source.kind === 'past' && source.listen !== undefined) {
      autoPlayed.current = true;
      listenWithoutText();
      return;
    }
    if (source.kind !== 'shelf' || !source.playAll) return;
    autoPlayed.current = true;
    const start = firstLine(text.lines);
    if (start !== null) playLine(start, true);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps -- once per text

  // What Next opens: the next text in the shelf's order, else whatever the shelf has now (a text
  // written since). Looked up when the end view shows, and when Play all moves on. Play all goes
  // through Up next's texts only (`upNextOrder`): the story's episode has its own card and isn't
  // part of it. Throws when the shelf can't be reached, so the end view can say so rather than look
  // like there's nothing next.
  const findNext = async (playingAll = false): Promise<UpNext | null> => {
    if (source.kind !== 'shelf' || !text) return null;
    const shelf = await api.shelf();
    const order = (playingAll ? upNextOrder(shelf) : playOrder(shelf)).filter((id) => id !== text.id);
    const listed = nextInOrder(source.order, text.id);
    const id = listed !== null && order.includes(listed) ? listed : (order[0] ?? null);
    const card = [...(shelf.story?.next ? [shelf.story.next] : []), ...shelf.texts].find((t) => t.id === id);
    return card ? { id: card.id, title: card.title, lines: card.lines, order } : null;
  };

  // Saves the pick as it's made, since the server writes the next episode from it once this one is read.
  const choose = (index: number) => {
    if (!text) return;
    const seq = ++choiceSeq.current;
    const before = chosen;
    setChosen(index);
    setChoiceError(null);
    api.chooseNext(text.id, index).catch((e) => {
      // A later tap, or another text, has taken over since: leave its state alone.
      if (!mounted.current || seq !== choiceSeq.current) return;
      setChosen(before);
      setChoiceError(e instanceof ApiError ? e.message : "Couldn't save your choice. Try again.");
    });
  };

  const playNext = async () => {
    if (!text || !session || logged.current || source.kind !== 'shelf') return;
    logged.current = true;
    try {
      await within(api.logReading(text.id, toLog(session, Date.now(), true)), BETWEEN_TEXTS_MS);
    } catch {
      // The reading is lost, not your place: carry on either way.
    }
    const next = await within(findNext(true), BETWEEN_TEXTS_MS).catch(() => null);
    if (!mounted.current) return;
    if (next) onNext({ kind: 'shelf', textId: next.id, order: next.order, playAll: true });
    else setEnded(true);
  };

  const chooseLength = async (step: LengthStep) => {
    setLengthStep(step);
    setSteerError(null);
    try {
      onSettings(await api.updateSettings({ lines: stepLength(baseLength.current, step) }));
    } catch (e) {
      setSteerError(e instanceof ApiError ? e.message : "Couldn't change that. Try again.");
    }
  };

  // Finishing a text (Done) logs it once, which also takes it off the ready queue. Backing out
  // before Done logs nothing, so the same text is waiting next time instead of a new one.
  const finish = async (then: 'next' | 'back', leaveWith?: () => void) => {
    // How the screen is left: the router's own continuation when the swipe or Back button asked
    // (it also turns the guard off), else turning the guard off and going back.
    const leave = leaveWith ?? (() => { stopGuarding(); onDone(); });
    player.pause();
    if (leaving) {
      // Back while Next text is still logging: drop the load that would follow it.
      if (then === 'back') {
        loadId.current++;
        leave();
      }
      return;
    }
    // A listen-only pass is only offered after Done, so it counts as finished too. Reading a past
    // text again is never logged.
    const finished = ended || (session?.listenOnly ?? false);
    if (text && session && finished && !review && !logged.current) {
      logged.current = true;
      setLeaving(then);
      try {
        await api.logReading(text.id, toLog(session, Date.now(), true, checkPicks ? loggedScore(check, checkPicks) : null));
        // Counts toward today's extra for this language (Daily extras).
        recordExtraRead(text.language ?? 'th');
      } catch {
        // The reading is lost, not your place: carry on either way.
      } finally {
        if (mounted.current) setLeaving(null);
      }
    }
    if (!mounted.current) return;
    if (then === 'back') leave();
    else load();
  };

  // A finished text is logged before the screen goes, however it goes: the Back button, the swipe,
  // or Back to topics. Without this a swipe skipped the log and the text stayed queued.
  const needsLog = !!text && !!session && (ended || session.listenOnly) && !review && !logged.current;
  const stopGuarding = usePreventRemove(needsLog || leaving !== null, ({ repeat }) => { finish('back', repeat); });

  const tap = (word: Word, x: number, y: number) => {
    if (!session || !text) return;
    if (quiz.begin(word)) return;
    openWord(word, x, y);
  };

  // Shows a word's popover. A word whose meaning waits to be asked for (guess first) isn't a lookup
  // until it's shown (`onReveal`); any other is one now.
  const openWord = (word: Word, x: number, y: number) => {
    if (!session) return;
    const mode = tapMode(word, text, prefs().guessFirst, prefs().quizKnown);
    if (!mode) setSession(lookUp(session, word.text));
    setTapped({ word, x, y, guess: mode });
  };

  // A practice word's pill opens the same popover as the word in the text.
  const openPracticeWord = (text_: string, x: number, y: number) => {
    if (!session || !text) return;
    const word = text.lines.flatMap((l) => l.words).find((w) => w.text === text_);
    if (!word) return;
    openWord(word, x, y);
  };

  // Holding a word and dragging to the last word of a phrase; held without dragging, it's a tap.
  const phraseDrag = usePhraseDrag({ lines: text?.lines ?? null, setPhrase, onHeld: tap });

  // A word's part in the phrase: where it sits in the selected phrase.
  const phraseLook = (line: number, word: Word, words: Word[]) => {
    const range = phrase ? phraseRange(phrase) : null;
    const here = range && line >= range.from.line && line <= range.to.line ? words.indexOf(word) : -1;
    return { phrasePart: here >= 0 ? phrasePart(phrase, line, here) : null };
  };

  const toggleLineEnglish = (i: number) => {
    setLineEnglish((shown) => (shown.includes(i) ? shown.filter((n) => n !== i) : [...shown, i]));
  };

  const toggleExplained = (i: number) => {
    setExplained((open) => (open.includes(i) ? open.filter((n) => n !== i) : [...open, i]));
  };

  const listenWithoutText = () => {
    if (!text) return;
    setSession((s) => (s ? listenedOnly(s) : s));
    setListenOnly(true);
    setPhrase(null);
    setEnded(false);
    scrollY.current = null; // the lines' scroll view is mounted fresh, at the top
    const start = firstLine(text.lines);
    if (start !== null) playLine(start, true);
  };

  const turnOnParagraphs = (on: boolean) => {
    savePrefs({ paragraphs: on });
    setParagraphMode(on);
  };

  const chooseThaiFont = (font: ThaiFont) => {
    savePrefs({ thaiFont: font });
    setThaiFont(font);
  };

  const chooseTextSize = (size: TextSize) => {
    savePrefs({ textSize: size });
    setTextSize(size);
  };

  const turnOnFormQuiz = (on: boolean) => {
    savePrefs({ formQuiz: on });
    setFormQuizOn(on);
  };

  const turnOnHighlight = (on: boolean) => {
    savePrefs({ highlight: on });
    setHighlight(on);
  };

  const turnOnMarkNames = (on: boolean) => {
    savePrefs({ markNames: on });
    setMarkNames(on);
  };

  // The key's switches: the first two marks have their own settings, the rest share a list.
  const showMark = (mark: Mark, on: boolean) => {
    if (mark === 'highlight') return turnOnHighlight(on);
    if (mark === 'name') return turnOnMarkNames(on);
    const next = withMark(hiddenMarks, mark, on);
    savePrefs({ hiddenMarks: next });
    setHiddenMarks(next);
  };
  const markShown = (mark: Mark) => mark === 'highlight' ? highlight : mark === 'name' ? markNames : !hiddenMarks.includes(mark as HideableMark);

  // Where the finished phrase is on screen, for its popup to open beside. Measured once the phrase is
  // complete and no longer dragged; the popup is a modal, so the text can't scroll under it.
  const [phraseAnchor, setPhraseAnchor] = useState<PhraseAnchor | null>(null);
  const phraseKey = phrase ? `${phrase.start.line}:${phrase.start.index}:${phrase.end.line}:${phrase.end.index}` : null;
  useEffect(() => {
    setPhraseAnchor(null);
    const range = phrase && text && !phraseDrag.dragging ? phraseRange(phrase) : null;
    if (!phrase || !text || !range) return;
    const first = text.lines[range.from.line]?.words[range.from.index];
    const last = text.lines[range.to.line]?.words[range.to.index];
    if (!first || !last) return;
    let current = true;
    Promise.all([phraseDrag.measureWord(first), phraseDrag.measureWord(last)]).then(([a, b]) => {
      if (current && a && b) setPhraseAnchor({ top: a.y, bottom: b.y + b.height });
    });
    return () => { current = false; };
    // Only when the phrase or the drag changes: the text sits still under the popup.
  }, [phraseKey, phraseDrag.dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const seconds = session ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
  const hasAudio = text ? firstLine(text.lines) !== null : false;

  return (
    <Screen
      largeTitle={false}
      // The player is a panel of its own, so the controls read as separate from the lines above.
      footerStyle={text && !ended && hasAudio ? {
        backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, ...smooth,
        borderTopWidth: hairline, borderColor: c.border, paddingTop: space.l,
        ...lift(c, 'high'), shadowOffset: { width: 0, height: -4 },
      } : undefined}
      // The swipe back would take the touch from a phrase drag that starts near the left edge or
      // runs left to right. iOS decides whether a touch can be a back swipe when the finger lands,
      // so locking it once the long press has fired (`phraseDrag.dragging`) was too late: it is off
      // for as long as the words can be selected. The Back button and Back to topics still leave.
      lockGesture={!!text && !!session && !ended && !listenOnly}
      toolbar={text && !ended && !listenOnly ? (
        <Stack.Toolbar placement="right">
          {text.xray?.length ? <Stack.Toolbar.Button icon="person.2" accessibilityLabel="Characters" onPress={() => { haptic.tap(); setXrayOpen(true); }} /> : null}
          {keyMarks.length > 0 ? (
            <Stack.Toolbar.Button icon="questionmark.circle" accessibilityLabel="Key to the marks on words" onPress={() => { haptic.tap(); setKeyOpen(true); }} />
          ) : null}
          <Stack.Toolbar.Menu icon="gearshape" accessibilityLabel="Reading options">
            <Stack.Toolbar.MenuAction isOn={english} onPress={() => setEnglish(!english)}>Show English</Stack.Toolbar.MenuAction>
            {quiz.any ? (
              <Stack.Toolbar.MenuAction isOn={formQuizOn} onPress={() => turnOnFormQuiz(!formQuizOn)}>Practice word forms</Stack.Toolbar.MenuAction>
            ) : null}
            {marked ? (
              <Stack.Toolbar.MenuAction isOn={paragraphMode} onPress={() => turnOnParagraphs(!paragraphMode)}>Paragraphs</Stack.Toolbar.MenuAction>
            ) : null}
            <Stack.Toolbar.Menu inline title="Text size">
              {TEXT_SIZES.map((s) => (
                <Stack.Toolbar.MenuAction key={s} isOn={textSize === s} onPress={() => chooseTextSize(s)}>{TEXT_SIZE_LABELS[s]}</Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            {text.language === 'th' || text.language === undefined ? (
              <Stack.Toolbar.Menu inline title="Thai letters">
                {THAI_FONTS.map((f) => (
                  <Stack.Toolbar.MenuAction key={f} isOn={thaiFont === f} onPress={() => chooseThaiFont(f)}>{THAI_FONT_LABELS[f]}</Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
            ) : null}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : undefined}
      footer={text && !ended ? (
        <>
          {hasAudio ? (
            <PlayerBar playing={sounding} current={current} total={text.lines.length} skippable={paras !== null} onSkip={skip}
              rate={rate} slowOffered={slowOffered} repeat={repeat} played={played} loopText={loopText} breaking={breaking} silentLine={silentLine} onToggle={togglePlay} onRate={changeRate} onRepeat={cycleRepeat} onLoop={toggleLoop} onStartOver={startOver}
              rec={current !== null ? self : null} />
          ) : <Help>No audio for this text.</Help>}
        </>
      ) : undefined}
    >
      {/* Centered in the whole screen frame, which runs under the native header. The automatic inset
          would add the header's height on top of that centering and push the spinner below the middle. */}
      {!text ? (
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ ...readable, flexGrow: 1, justifyContent: 'center' }}>
          {error ? (
            <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={load} /></View>
          ) : (
            writing ? (
              <View style={{ padding: space.l }}>
                <MakingCard title={source.kind === 'topic' ? source.topic.name : 'A new text'} steps={textSteps(writeStage)} />
              </View>
            ) : (
              <View style={{ padding: space.xxl, alignItems: 'center', gap: space.m }}>
                <ActivityIndicator color={c.accent} />
                <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>Opening the text</Text>
              </View>
            )
          )}
        </ScrollView>
      ) : null}

      {xrayOpen && text?.xray ? <ReaderXray characters={text.xray} episode={text.episode} onClose={() => setXrayOpen(false)} /> : null}

      {keyOpen && text ? (
        <ReaderKey examples={keyMarks} language={text.language ?? 'th'} textStyle={readStyle(text, thaiFont, textSize)} shown={markShown} onChange={showMark} onClose={() => setKeyOpen(false)} />
      ) : null}

      {text && session && !ended ? (
        <ScrollView
          ref={scroller}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ ...readable, paddingBottom: space.l }}
          onLayout={(e) => {
            viewHeight.current = e.nativeEvent.layout.height;
            scroller.current?.measureInWindow((_x, y) => { viewTop.current = y; });
          }}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; updateLineOff(); }}
          scrollEventThrottle={100}
          // Off while a phrase is dragged, or the scroll takes the finger back on its first move.
          scrollEnabled={!phraseDrag.dragging}
        >
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.l }}>
            <View style={{ gap: space.xs }}>
              <Text style={{ ...type.title, color: c.text }}>{text.title}</Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>
                {[
                  text.episode ? `${text.topic} · Episode ${text.episode}` : (text.topic ?? (source.kind === 'topic' ? source.topic.name : source.kind === 'past' ? source.text.topic : '')),
                  !listenOnly && underFloor(text) ? `${Math.round(text.coverage * 100)}% words known` : '',
                ].filter(Boolean).join(' · ')}
              </Text>
              {text.last_time ? (
                <ReadRecap
                  recap={text.last_time.recap}
                  line={text.last_time.line}
                  language={text.language}
                  tapped={tapped?.word ?? null}
                  onTap={(word, x, y) => { haptic.tap(); setTapped({ word, x, y }); }}
                />
              ) : null}
            </View>
            {text.stretch.length > 0 || practicedGrammar(text).length > 0 ? (
              <Card style={{ padding: space.m, gap: space.m }}>
                {text.stretch.length > 0 ? (
                  <ChipRow label="Practice words">
                    {text.stretch.map((w) => <PracticeWordPill key={w} word={w} onPress={(x, y) => openPracticeWord(w, x, y)} />)}
                  </ChipRow>
                ) : null}
                {practicedGrammar(text).length > 0 ? (
                  <ChipRow label="Grammar">
                    {practicedGrammar(text).map((g) => <TintPill key={g.id} text={g.name} bg={c.speakerB} fg={c.onSpeakerB} />)}
                  </ChipRow>
                ) : null}
              </Card>
            ) : null}
            {text.roles.A || text.roles.B ? (
              <Card style={{ padding: space.m, gap: space.s }}>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>In this text</Text>
                {(['A', 'B'] as const).map((who) => text.roles[who] ? (
                  <View key={who} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                    <Speaker text={text} who={who} size={speakerSize(text, who, true)} />
                    <Text style={{ ...type.body, color: c.text, flexShrink: 1 }}>{text.roles[who]}</Text>
                  </View>
                ) : null)}
              </Card>
            ) : null}
            {source.kind === 'past' && !listenOnly && hasAudio ? (
              <ToggleRow label="Hear it again">
                <HeaderAction label="Listen without the text" onPress={listenWithoutText} />
              </ToggleRow>
            ) : null}
            {listenOnly ? (
              <ToggleRow label={listenGate ? `Listen first. The words show once every line has played ${listenGate === 2 ? 'twice' : 'through'}.` : 'Listening without the text'}>
                <HeaderAction label={listenGate ? 'Show the text now' : 'Show the text'} onPress={showText} />
              </ToggleRow>
            ) : (
              <>
                {highlight && countOutsideDeck(text) === 0 ? (
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>Every word in this text is in your deck.</Text>
                ) : null}
              </>
            )}
          </View>
          {paras ? paras.map((range, g) => {
            // Listening without the text, a paragraph has nothing to show or tap: no placeholder.
            if (listenOnly) return null;
            const lines = text.lines.slice(range.start, range.end + 1);
            return (
              <View
                key={g}
                onLayout={(e) => {
                  const { y, height } = e.nativeEvent.layout;
                  lineBoxes.current[g] = { y, height };
                }}
                style={{ paddingHorizontal: space.l, paddingBottom: space.l }}
              >
                <View {...phraseDrag.lineProps} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                  {lines.map((l, k) => (
                    <React.Fragment key={k}>
                      {wrapGroups(l.words).map((chunk, j, chunks) => (
                        <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {chunk.map((word, m) => (
                            <WordView
                              key={m}
                              word={word}
                              textStyle={readStyle(text, thaiFont, textSize)}
                              grammar={grammarOf(text, word)}
                              flagged={isFlagged(session, word.text)}
                              highlighted={highlight && isOutsideDeck(word)}
                              named={markNames && isName(word)}
                              selected={tapped?.word === word}
                              hidden={hiddenMarks}
                              {...phraseLook(range.start + k, word, l.words)}
                              playing={shaded === range.start + k}
                              spoken={spoken.has(word)}
                              slot={quiz.view(word)}
                              onPress={tap}
                              onLongPress={phraseDrag.begin}
                              viewRef={phraseDrag.wordRef(word)}
                            />
                          ))}
                          {/* The gap before the next sentence trails this one's last chunk, never starts a row of its own:
                              a lone spacer that wrapped to a new row indented that row. */}
                          {j === chunks.length - 1 && k < lines.length - 1
                            ? <View style={{ width: readStyle(text, thaiFont, textSize).fontSize * 0.5 }} /> : null}
                        </View>
                      ))}
                    </React.Fragment>
                  ))}
                </View>
                {english ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, marginTop: space.xs }}>{lines.map((l) => l.english).join(' ')}</Text>
                ) : null}
              </View>
            );
          }) : text.lines.map((line, i) => (
            <View
              key={i}
              onLayout={(e) => {
                const { y, height } = e.nativeEvent.layout;
                lineBoxes.current[i] = { y, height };
              }}
              style={{
                flexDirection: 'row', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m,
                borderBottomWidth: hairline, borderBottomColor: c.border,
                backgroundColor: shaded === i ? c.surface : undefined,
              }}
            >
              {line.speaker === 'N' ? null : (
                // Centered on the first line of words, which is a word's line height plus its
                // padding and underline border (4.5) tall; the speaker's mark is `speakerSize` tall.
                <View style={{ paddingTop: listenOnly ? 0 : Math.max(0, (readStyle(text, thaiFont, textSize).lineHeight + 4.5 - speakerSize(text, line.speaker)) / 2) }}>
                  <Speaker text={text} who={line.speaker} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                {listenOnly ? (
                  // As tall as the speaker's mark beside it, with the name centered in that height.
                  <View style={{ minHeight: line.speaker === 'N' ? undefined : speakerSize(text, line.speaker), justifyContent: 'center', paddingVertical: line.speaker === 'N' ? space.s : 0 }}>
                    <Text style={{ ...type.subhead, color: c.textSecondary }}>
                      {(line.speaker !== 'N' && text.roles[line.speaker]) || `Line ${i + 1}`}
                    </Text>
                  </View>
                ) : (
                  <View {...phraseDrag.lineProps} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {wrapGroups(line.words).map((group, j) => (
                      // A line breaks only between groups, so punctuation never wraps away from its word.
                      <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {group.map((word, k) => (
                          <WordView
                            key={k}
                            word={word}
                            textStyle={readStyle(text, thaiFont, textSize)}
                            grammar={grammarOf(text, word)}
                            flagged={isFlagged(session, word.text)}
                            highlighted={highlight && isOutsideDeck(word)}
                            named={markNames && isName(word)}
                            selected={tapped?.word === word}
                            hidden={hiddenMarks}
                            {...phraseLook(i, word, line.words)}
                            spoken={spoken.has(word)}
                            slot={quiz.view(word)}
                            onPress={tap}
                            onLongPress={phraseDrag.begin}
                            viewRef={phraseDrag.wordRef(word)}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                )}
                {/* The translation sits right under the words, above the buttons. While it's hidden, a
                    "Show translation" link holds its place (tap the English again to hide it), so the
                    buttons below only move down when it opens. With Show English on it's always shown. */}
                {!listenOnly && (english || lineEnglish.includes(i)) ? (
                  <Tappable
                    onPress={() => { haptic.tap(); toggleLineEnglish(i); }}
                    disabled={english}
                    accessibilityRole="button"
                    accessibilityLabel={`Hide translation for line ${i + 1}`}
                    style={{ alignSelf: 'flex-start', marginTop: space.xs }}
                  >
                    <Text style={{ ...type.subhead, color: c.textSecondary }}>{line.english}</Text>
                  </Tappable>
                ) : !listenOnly ? (
                  <Tappable
                    onPress={() => { haptic.tap(); toggleLineEnglish(i); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Show translation for line ${i + 1}`}
                    hitSlop={{ top: space.s, bottom: space.s }}
                    style={{ alignSelf: 'flex-start', marginTop: space.xs }}
                  >
                    <Text style={{ ...type.subhead, color: c.accent }}>Show translation</Text>
                  </Tappable>
                ) : null}
                <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.s }}>
                  {line.audio ? (
                    <RoundButton icon="play.fill" accessibilityLabel={`Play line ${i + 1}`} on onPress={() => playLine(i, false)} />
                  ) : null}
                  {!listenOnly ? (
                    <RoundButton
                      icon="sparkles"
                      accessibilityLabel={explained.includes(i) ? `Hide explanation for line ${i + 1}` : `Explain line ${i + 1}`}
                      on={explained.includes(i)}
                      expanded={explained.includes(i)}
                      onPress={() => toggleExplained(i)}
                    />
                  ) : null}
                  {!listenOnly ? <RegisterChip register={line.register} /> : null}
                </View>
                {!listenOnly && explained.includes(i) ? <LineExplanation api={api} textId={text.id} line={i} grammarChosen={grammarChosen} onGrammarChosen={chooseGrammar} onOpenGrammar={onOpenGrammar} /> : null}
              </View>
            </View>
          ))}
          {!listenOnly && choicesView(text, review) ? (
            <View style={{ paddingHorizontal: space.l, paddingBottom: space.l }}>
              <ReadChoices choices={text.choices ?? []} chosen={chosen} textStyle={readStyle(text, thaiFont, textSize)} onChoose={review ? null : choose} error={choiceError} showEnglish={english} />
            </View>
          ) : null}
          {review ? null : (
            <View style={{ padding: space.l }}>
              <Button label="Done" onPress={() => {
                const end = () => { player.pause(); setCheck(buildCheck(text, session)); setEnded(true); };
                // Finishing a story's episode logs it as read, and the server then writes the next
                // one, so a stray tap on Done is asked about first.
                if (source.kind === 'shelf' && (text.episode ?? 0) > 0) {
                  Alert.alert(`Finish episode ${text.episode}?`, `This saves it as read and starts writing episode ${(text.episode ?? 0) + 1}.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Finish', onPress: end },
                  ]);
                } else end();
              }} />
            </View>
          )}
        </ScrollView>
      ) : null}

      {text && session && !ended && !listenOnly && lineOff && current !== null ? (
        <ReaderJumpToLine line={current + 1} side={lineOff} onPress={followCurrent} />
      ) : null}

      {text && session && ended && checking && !drilling ? (
        <ReaderCheck
          api={api}
          text={text}
          questions={check}
          picks={checkPicks ?? {}}
          textStyle={readStyle(text, thaiFont, textSize)}
          onPick={(key, pick) => setCheckPicks((prev) => ({ ...prev, [key]: pick }))}
          onDone={() => setChecking(false)}
        />
      ) : null}

      {text && session && ended && drilling === 'retell' ? (
        <ReadRetell api={api} text={text} textStyle={readStyle(text, thaiFont, textSize)} onDone={() => setDrilling(null)} />
      ) : null}

      {text && session && ended && drilling && drilling !== 'retell' ? (
        <ReadLineDrill
          api={api}
          text={text}
          kind={drilling}
          textStyle={readStyle(text, thaiFont, textSize)}
          explain={(line) => <LineExplanation api={api} textId={text.id} line={line} grammarChosen={grammarChosen} onGrammarChosen={chooseGrammar} onOpenGrammar={onOpenGrammar} />}
          onDone={() => setDrilling(null)}
        />
      ) : null}

      {text && session && ended && !checking && !drilling ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, paddingHorizontal: space.l, paddingBottom: space.l }}>
          <Reveal style={{ gap: space.m }}>
            {check.length ? (
              <CheckCard text={text} questions={check} picks={checkPicks} onStart={() => { setCheckPicks((prev) => prev ?? {}); setChecking(true); }} />
            ) : null}
            <LineDrillCard text={text} onStart={(kind) => { player.pause(); setDrilling(kind); }} onRetell={() => { player.pause(); setDrilling('retell'); }} />
            <View style={{ flexDirection: 'row', gap: space.s }}>
              <Stat value={`${Math.round(text.coverage * 100)}%`} label="Words you know" />
              <Stat value={String(session.glossed.length)} label="Words looked up" />
              <Stat value={formatDuration(seconds)} label="Time" />
            </View>
            {session.flagged.length > 0 ? (
              <Card style={{ gap: 0 }}>
                <Text style={{ ...type.headline, color: c.text, paddingBottom: space.s }}>Marked as unknown</Text>
                {session.flagged.map((w, i) => (
                  <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: i === 0 ? 0 : hairline, borderTopColor: c.border }}>
                    <Text style={{ ...type.body, color: c.text }}>{w}</Text>
                    <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{glossFor(text, w) ?? ''}</Text>
                  </View>
                ))}
                <View style={{ paddingTop: space.s }}><Help>These are kept in Marked words, where the ones not in your deck can be added to it.</Help></View>
              </Card>
            ) : null}
            {problem && source.kind === 'shelf' && !review ? (
              <Help>{problem === 'offline'
                ? "Offline. This reading is saved on this iPhone and sent when you're back online."
                : "Your server isn't answering. This reading is saved on this iPhone and sent once it does."}</Help>
            ) : null}
            {source.kind === 'shelf' && !problem ? (
              <Card style={{ gap: space.m }}>
                <View style={{ gap: 2 }}>
                  <Text style={{ ...type.headline, color: c.text }}>For the next ones</Text>
                  <Help>Changes the texts written from now on. Texts already written stay as they are.</Help>
                </View>
                <View style={{ gap: space.xs }}>
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>Length</Text>
                  <Segments<LengthStep>
                    options={[{ value: 'shorter', label: 'Shorter' }, { value: 'same', label: 'Same' }, { value: 'longer', label: 'Longer' }]}
                    value={lengthStep}
                    onChange={chooseLength}
                  />
                </View>
                <ReadGrammarDial api={api} />
                {steerError ? <ErrorNote message={steerError} /> : null}
              </Card>
            ) : null}
            {source.kind !== 'shelf' ? (
              <Button label="Next text" onPress={() => finish('next')} busy={leaving === 'next'} />
            ) : null}
            <Button label={review ? 'Back to the list' : 'Back to Read & Listen'} variant={source.kind === 'shelf' ? 'primary' : 'secondary'} onPress={() => finish('back')} busy={leaving === 'back'} />
          </Reveal>
        </ScrollView>
      ) : null}

      <GlossPopover
        tapped={tapped}
        characters={text?.xray}
        onXray={text?.xray?.length ? () => { setTapped(null); setXrayOpen(true); } : undefined}
        language={text?.language}
        grammar={tapped && text ? grammarOf(text, tapped.word) : null}
        api={api}
        grammarChosen={grammarChosen}
        onGrammarChosen={chooseGrammar}
        flagged={tapped && session ? isFlagged(session, tapped.word.text) : false}
        onToggleFlag={review ? null : () => { if (tapped) setSession((s) => (s ? toggleFlag(s, tapped.word.text) : s)); }}
        onReveal={() => { if (tapped) setSession((s) => (s ? lookUp(s, tapped.word.text) : s)); }}
        onQuizAnswer={(right) => { if (tapped) setSession((s) => (s ? answerQuiz(s, tapped.word.text, right) : s)); }}
        onPlay={() => {
          if (!tapped || !text) return;
          // The word and the line would talk over each other.
          player.pause();
          onPlayWord(tapped.word.text, text.language, saidAs(text.language, tapped.word.text, tapped.word.translit));
        }}
        // A word of "Last time" isn't in the text's lines, so there's no phrase to start from it.
        onAddToDeck={mining?.language === text?.language && mining && tapped && !tapped.word.deck && tapped.word.status !== 'name' ? () => {
          // The popover is a modal, so it closes before the note editor opens over the reader.
          const word = tapped.word.text;
          setTapped(null);
          void mining.onAdd(word, tapped.word.gloss ?? "", tapped.word).then((saved) => {
            // In the deck now, so no longer marked unknown.
            if (saved) setSession((s) => (s && isFlagged(s, word) ? toggleFlag(s, word) : s));
          });
        } : null}
        onClose={() => setTapped(null)}
      />
      {quiz.current ? (
        <ReaderFormQuiz key={quiz.current.key} api={api} language={text?.language ?? 'th'} textId={quiz.current.textId} line={quiz.current.line} word={quiz.current.word} before={quiz.current.before} after={quiz.current.after} onSettle={quiz.settle} onClose={quiz.close} />
      ) : null}
      {/* The selected phrase's explanation, keyed by the phrase so a new one asks again. */}
      {text && phrase && phraseAnchor && !listenOnly && !phraseDrag.dragging ? (
        <PhraseExplanation
          key={`${phraseRange(phrase).from.line}:${phraseRange(phrase).to.line}:${phraseText(text.lines, phrase)}`}
          api={api}
          textId={text.id}
          line={phraseRange(phrase).from.line}
          toLine={phraseRange(phrase).to.line}
          phrase={phraseText(text.lines, phrase)}
          anchor={phraseAnchor}
          // Only into the deck of the language being read.
          mining={mining?.language === text.language ? mining : undefined}
          onClose={() => setPhrase(null)}
        />
      ) : null}
    </Screen>
  );
}

/** The reading size for a text's language. */
function readStyle(text: ReaderText, thaiFont: ThaiFont, textSize: TextSize) {
  const language = text.language ?? 'th';
  const info = LANGUAGES[language];
  const fontSize = scaledFontSize(info.fontSize, textSize);
  return { fontSize, lineHeight: fontSize * info.lineHeight, font: readFont(language, thaiFont) };
}

function practicedGrammar(text: ReaderText): TextGrammar[] {
  return (text.grammar ?? []).filter((g) => g.role === 'practice');
}

function grammarOf(text: ReaderText, word: Word): TextGrammar | null {
  return word.grammar ? ((text.grammar ?? []).find((g) => g.id === word.grammar) ?? null) : null;
}

function glossFor(text: ReaderText, word: string): string | null {
  for (const line of text.lines) for (const w of line.words) if (w.text === word && w.gloss) return w.gloss;
  return null;
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.textSecondary }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.m, minHeight: MIN_TAP }}>
      <Text style={{ ...type.subhead, color: c.textSecondary, flexShrink: 1 }}>{label}</Text>
      {children}
    </View>
  );
}

/** A line's replay and explain buttons: a full tap target, filled when on. */
function RoundButton({ icon, accessibilityLabel, on, expanded, onPress }: {
  icon: SFSymbol;
  accessibilityLabel: string;
  on: boolean;
  /** For a button that shows something under the line (an explanation): whether it's showing. */
  expanded?: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const fg = on ? c.accentInk : c.textSecondary;
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      scaleTo={0.92}
      style={{
        minWidth: MIN_TAP, minHeight: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: on ? c.accentFill : c.fill,
      }}
    >
      <Icon name={icon} size={16} color={fg} weight="semibold" />
    </Tappable>
  );
}

const POPOVER_WIDTH = 290;
// Space between the tap and the popover's edge, enough to clear the tapped word.
const POPOVER_GAP = 28;

export function GlossPopover({ tapped, characters, onXray, language, grammar, api, grammarChosen, onGrammarChosen, flagged, onToggleFlag, onReveal, onQuizAnswer, onPlay, onAddToDeck, onClose }: {
  tapped: Tapped | null;
  /** The series' characters as of this episode (X-Ray): a name word that is one shows who they are in place of "A name". */
  characters?: StoryCharacter[];
  /** Opens the X-Ray sheet, offered on a character's name. */
  onXray?: () => void;
  /** The language the word is in, for its form's explanation; none, and no form chip is shown (a card's sentence has no forms). */
  language?: Language;
  grammar: TextGrammar | null;
  api: Api;
  grammarChosen: Record<string, GrammarChoice>;
  onGrammarChosen: (id: string, state: GrammarChoice) => void;
  flagged: boolean;
  onPlay: () => void;
  /** null when marking isn't recorded (reading a past text). */
  onToggleFlag: (() => void) | null;
  /** The meaning of a word that was held back (`tapped.guess`) has just been shown: a lookup. */
  onReveal?: () => void;
  /** The quiz on a known word was answered: right, or wrong (a wrong pick or "I don't know"). A record, not a lookup. */
  onQuizAnswer?: (right: boolean) => void;
  /** Opens the note editor on this word; null when the word is in the deck or isn't in the language being read. */
  onAddToDeck: (() => void) | null;
  /** How many more words can be added to the deck today. */
  onClose: () => void;
}) {
  const c = useTheme();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Measured on first layout (drawn invisible until then), since a long gloss wraps.
  const [popHeight, setPopHeight] = useState(0);
  // The form chip's explanation replaces the popover while it's open.
  const [showForm, setShowForm] = useState(false);
  // A word whose meaning is held back (`tapped.guess`): whether it has been shown, and the quiz
  // choice picked (null for "I don't know").
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => { setPopHeight(0); setShowForm(false); setRevealed(false); setPicked(null); }, [tapped]);
  if (!tapped) return null;
  const character = characterOfWord(tapped.word, characters);
  if (showForm && language && tapped.word.form) return <ReadFormSheet api={api} language={language} word={tapped.word} onClose={onClose} />;
  const popWidth = Math.min(POPOVER_WIDTH, width - 2 * space.l);
  const left = Math.min(Math.max(tapped.x - 40, space.l), width - popWidth - space.l);
  // Above the word when it clears the status bar, so the finger and the word both stay visible;
  // otherwise below it, and never past the bottom edge.
  const above = tapped.y - POPOVER_GAP - popHeight;
  const top = Math.min(above >= insets.top + space.s ? above : tapped.y + POPOVER_GAP, height - popHeight - insets.bottom - space.s);
  // The IPA's and the deck icon's tooltips open above the popover's text, and below it when the popover is too near the top of the screen.
  const tipBelow = top < insets.top + 40;
  const mode = tapped.guess ?? null;
  // Meaning held back until asked for.
  const trying = !!mode && !revealed;
  const reveal = () => { setRevealed(true); onReveal?.(); };
  const actions: Parameters<typeof WordActionRow>[0][] = [];
  if (trying) {
    if (!mode.quiz) actions.push({ icon: 'eye', label: 'Show meaning', accessibilityLabel: `Show the meaning of ${tapped.word.text}`, onPress: reveal, chevron: false });
    // Marking a word unknown says its meaning wasn't known, so it's shown too.
    if (onToggleFlag) actions.push({ icon: flagged ? 'flag.slash' : 'flag', label: flagged ? 'Unmark' : 'Mark as unknown', onPress: () => { reveal(); onToggleFlag(); }, chevron: false });
  } else {
    if (character && onXray) actions.push({ icon: 'person.2', label: 'See all characters', onPress: onXray });
    if (onAddToDeck) actions.push({ icon: 'plus.circle', label: 'Add to deck', accessibilityLabel: `Add ${tapped.word.text} to your deck`, onPress: onAddToDeck });
    if (onToggleFlag) actions.push({ icon: flagged ? 'flag.slash' : 'flag', label: flagged ? 'Unmark' : 'Mark as unknown', onPress: onToggleFlag, chevron: false });
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <View
        onLayout={(e) => setPopHeight(e.nativeEvent.layout.height)}
        onAccessibilityEscape={onClose}
        style={{ position: 'absolute', top, left, width: popWidth, opacity: popHeight > 0 ? 1 : 0 }}
      >
      {/* Springs up from the word once measured; the box that measures is the one around it. */}
      <Pop
        ready={popHeight > 0}
        style={{
          backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, borderRadius: radius.l, ...smooth,
          padding: space.l, gap: space.xs, ...lift(c, 'high'),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <ReadWordTitle text={tapped.word.text} pronunciation={tapped.word} ipaTip={{ below: tipBelow }} />
            {trying ? (
              <GuessPrompt
                mode={mode}
                onPick={(i) => {
                  setPicked(i);
                  if (i === mode.quiz?.answer) {
                    // Stays open so the meaning is seen; not a lookup, since it was recalled.
                    rightAnswer();
                    setRevealed(true);
                    onQuizAnswer?.(true);
                    return;
                  }
                  onQuizAnswer?.(false);
                  reveal();
                }}
                onGiveUp={() => { onQuizAnswer?.(false); reveal(); }}
              />
            ) : (
              <>
                {tapped.word.lemma ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Dictionary form: {tapped.word.lemma}</Text> : null}
                <ReadGlossLine
                  word={tapped.word}
                  below={tipBelow}
                  meaning={mode?.quiz && revealed ? <QuizChoices choices={mode.quiz.choices} answer={mode.quiz.answer} picked={picked} /> : character ? <Text style={{ ...type.body, color: c.text, flexShrink: 1 }}>{character.description}</Text> : undefined}
                />
                {(tapped.word.form && helperNote(tapped.word.form)) || tapped.word.contraction ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary }}>{(tapped.word.form && helperNote(tapped.word.form)) || tapped.word.contraction}</Text>
                ) : null}
                {tapped.word.form && language ? <ReadFormChip name={tapped.word.form.name} onPress={() => setShowForm(true)} /> : null}
                {tapped.word.translit ? <Text style={{ ...type.body, color: c.textSecondary }} selectable>{tapped.word.translit}</Text> : null}
                {tapped.word.kanji?.length ? <ReadKanji kanji={tapped.word.kanji} /> : null}
                <ReadFrequency word={tapped.word} />
                {character ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Character. {firstSeen(character)}</Text> : inDeck(tapped.word) || (wordStatus(tapped.word) === COMMON_WORD_STATUS && wordFrequency(tapped.word)) ? null : (
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{wordStatus(tapped.word)}</Text>
                )}
              </>
            )}
          </View>
          <WordPlayButton onPress={onPlay} />
        </View>
        {grammar && !trying ? <ReadGrammarNote grammar={grammar} api={api} chosen={grammarChosen[grammar.id]} onChosen={onGrammarChosen} /> : null}
        {actions.length > 0 ? (
          <WordActionGroup>
            {actions.map((a, i) => <WordActionRow key={a.label} first={i === 0} {...a} />)}
          </WordActionGroup>
        ) : null}
      </Pop>
      </View>
    </Modal>
  );
}

function PlayerBar({ playing, current, total, skippable, onSkip, rate, slowOffered, repeat, played, loopText, breaking, silentLine, onToggle, onRate, onRepeat, onLoop, onStartOver, rec }: {
  playing: boolean;
  current: number | null;
  total: number;
  /** Previous and next line buttons, for a story with no play button on each line. */
  skippable: boolean;
  onSkip: (step: -1 | 1) => void;
  rate: number;
  /** Whether the language offers Slow: the speed control is left out when it doesn't. */
  slowOffered: boolean;
  /** Plays per line: 1 is off, Infinity is until turned off. */
  repeat: number;
  /** How many times the current line has played in this round. */
  played: number;
  /** Loop text: Play all goes back to the first line after the last. */
  loopText: boolean;
  /** The pause between the last line and the first, while Loop text goes round. */
  breaking: boolean;
  silentLine: number | null;
  onToggle: () => void;
  onRate: (rate: number) => void;
  onRepeat: () => void;
  onLoop: () => void;
  /** Play from the first line. */
  onStartOver: () => void;
  /** Record yourself, once a line has played. */
  rec: SelfRecording | null;
}) {
  const c = useTheme();
  const repeating = repeat > 1;
  const play = (
    <Tappable
      onPress={() => { haptic.tap(); onToggle(); }}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause' : 'Play'}
      scaleTo={0.92}
      style={{ width: 52, height: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent }}
    >
      <Icon name={playing ? 'pause.fill' : 'play.fill'} size={22} color={c.onAccent} weight="semibold" />
    </Tappable>
  );
  const repeatNote = repeat === Infinity ? 'Repeating this line' : `Repeating this line (${Math.min(played, repeat)} of ${repeat})`;
  const loopNote = repeating ? `${repeatNote}. Looping the whole text.` : 'Looping the whole text';
  const note = breaking ? LOOP_BREAK_NOTE : silentLine !== null ? `Line ${silentLine + 1} has no audio.` : loopText ? loopNote : repeating ? repeatNote : skippable ? null : "Tap a line's play button to replay it";
  const label = current === null && !note ? null : (
    <View style={{ alignItems: 'center' }}>
      {current === null ? null : <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{`Line ${current + 1} of ${total}`}</Text>}
      {note ? <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>{note}</Text> : null}
    </View>
  );
  // One tap steps Off, 2×, 3×, 5×, ∞ (playback.ts), so the choices share one button: unfilled when off,
  // filled with the count in a badge when on.
  const badge = repeatBadge(repeat);
  const chip = (
    <Tappable
      onPress={() => { haptic.select(); onRepeat(); }}
      accessibilityRole="button"
      accessibilityLabel="Repeat line"
      accessibilityValue={{ text: repeating ? (repeat === Infinity ? 'Until turned off' : `${repeat} times`) : 'Off' }}
      scaleTo={0.92}
      style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: repeating ? c.accent : c.fill }}
    >
      <RepeatLineIcon color={repeating ? c.onAccent : c.textSecondary} />
      {badge ? (
        <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, minHeight: 18, paddingHorizontal: 4, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.text, borderWidth: 2, borderColor: c.surface }}>
          <Text style={{ ...type.caption, fontWeight: '700', color: c.bg }}>{badge}</Text>
        </View>
      ) : null}
    </Tappable>
  );
  // Loop text sits beside Repeat line: the same loop around a block of lines, filled while on.
  const loop = (
    <Tappable
      onPress={() => { haptic.select(); onLoop(); }}
      accessibilityRole="button"
      accessibilityLabel="Loop text"
      accessibilityValue={{ text: loopText ? 'On' : 'Off' }}
      scaleTo={0.92}
      style={{ width: MIN_TAP, height: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: loopText ? c.accent : c.fill }}
    >
      <LoopTextIcon color={loopText ? c.onAccent : c.textSecondary} />
    </Tappable>
  );
  const startOver = (
    <Tappable
      onPress={() => { haptic.tap(); onStartOver(); }}
      accessibilityRole="button"
      accessibilityLabel="Start over"
      scaleTo={0.92}
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}
    >
      <StartOverIcon color={c.textSecondary} />
    </Tappable>
  );
  return (
    <View style={{ gap: space.m }}>
      {label}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.m }}>
        {startOver}
        {skippable ? <SkipButton icon="backward.end.fill" label="Previous line" onPress={() => onSkip(-1)} /> : null}
        {play}
        {skippable ? <SkipButton icon="forward.end.fill" label="Next line" onPress={() => onSkip(1)} /> : null}
        {/* Start over's width on the other side keeps Play in the middle. */}
        <View style={{ width: MIN_TAP }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
        {slowOffered ? <Segments style={{ flex: 1 }} options={RATES.map((r) => ({ value: r, label: isSlow(r) ? 'Slow' : 'Normal', accessibilityLabel: isSlow(r) ? 'Slow speed' : 'Normal speed' }))} value={rate} onChange={onRate} /> : <View style={{ flex: 1 }} />}
        {chip}
        {loop}
        {rec && current !== null && idleRecording(rec) ? <RecordIconButton rec={rec} label={`Record line ${current + 1}`} /> : null}
      </View>
      {rec && current !== null && !idleRecording(rec) ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
          <RecordYourself rec={rec} label={`Record line ${current + 1}`} size="player" />
        </View>
      ) : null}
    </View>
  );
}

/** Previous or next line in the player bar. */
function SkipButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  const c = useTheme();
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.92}
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.fill }}
    >
      <Icon name={icon} size={16} color={c.textSecondary} weight="semibold" />
    </Tappable>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, borderRadius: radius.m, ...smooth, padding: space.m }}>
      <Text style={{ ...type.title, color: c.text }}>{value}</Text>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}
