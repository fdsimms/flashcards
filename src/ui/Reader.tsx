import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Stack, usePreventRemove } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SFSymbol } from 'expo-symbols';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, type Api, type GrammarChoice, type Language, type Length, type PastText, type Rating, type ReaderText, type Settings, type TextGrammar, type Word } from '../reader/api';
import { countOutsideDeck, isName, isOutsideDeck, underFloor } from '../reader/deckWords';
import { marksIn, withMark, type HideableMark, type Mark } from '../reader/marks';
import { scrollTarget, type Box } from '../reader/follow';
import { THAI_FONTS, THAI_FONT_LABELS, readFont, type ThaiFont } from '../reader/fonts';
import { LANGUAGES, wordStatus } from '../reader/languages';
import { firstLine, nextLine, nextRepeatCount, paragraphs, previousLine, rangeOf, repeatChipLabel } from '../reader/playback';
import { RATES } from '../reader/playbackRate';
import { minutesFor, nextInOrder, playOrder, stepLength, type LengthStep } from '../reader/shelf';
import { formatDuration, heard, isFlagged, listenedOnly, lookUp, startSession, toggleFlag, toLog, type Session } from '../reader/session';
import { locate, phrasePart, phraseText, pickEnd, type PhrasePick } from '../reader/phrase';
import { choicesView, holdsPlayAll } from '../reader/choices';
import { prefs, savePrefs } from '../reader/storage';
import { wrapGroups } from '../reader/wordLayout';
import { haptic } from './haptics';
import { LineExplanation } from './ReaderExplain';
import { RegisterChip } from './ReaderNatural';
import { PhraseExplanation, PhrasePickBanner, type PhraseMining } from './ReaderPhrase';
import { ReadChoices } from './ReadChoices';
import { usePhraseDrag } from './usePhraseDrag';
import { ReadGrammarNote } from './ReadGrammarNote';
import { WordView } from './ReadWord';
import { ReaderKey } from './ReaderKey';
import { WordActionGroup, WordActionRow, WordPlayButton } from './ReadWordActions';
import { Speaker, speakerSize } from './ReadSpeaker';
import { useSpokenWords } from './useSpokenWords';
import { Button, Card, Chip, ErrorNote, HeaderAction, Help, Icon, Screen, Segments, Tappable } from './kit';
import { lift, MIN_TAP, radius, space, type, useTheme } from './theme';

/**
 * The reader: a text split into words by the server, a gloss on tap, audio line by line, and a
 * rating at the end (docs/read-and-listen/architecture.md, Client). Nothing here answers a card.
 *
 * Layout: the title, practice words, the lines (each with
 * its own replay button, an EN button that shows that line's English alone, and an explain button
 * that opens Claude's note on its grammar and vocabulary under it), then Done, with
 * the player pinned under the scroll view. Done swaps the lines for the end view (rating, stats,
 * words marked unknown). The gloss popover is a transparent Modal, so a tap's page coordinates
 * place it directly.
 *
 * Reading options (Show English, Paragraphs, Thai letters) are one header menu, so the text
 * starts right under the practice words. The key to the marks on words, with a switch for each, is a
 * row in that card (ReaderKey.tsx).
 *
 * From the shelf: a text already written opens straight away, and the end view steers the next
 * ones (length, more or fewer like this) and offers the next text on the shelf. Play all plays the
 * shelf's texts one after another, logging each as read once its last line has played.
 *
 * Reading again: a past text opens here with nothing logged (no Done, no rating, no marking words
 * unknown), since a second reading isn't recorded. One rated About right can be played with the
 * text hidden straight away.
 *
 * Listen only: once a text is rated About right, the end view offers to play it again with the
 * text hidden (brief, design principle 6). The lines show who's speaking instead, and Show the text
 * brings the words back. The reading is logged as listen-only.
 *
 * A story written with paragraph marks reads as continuous text (`paragraphs`): a gap between
 * paragraphs, no per-line rows or buttons, the playing line shaded, and previous/next line in the
 * player. English then comes only from Show English. The Paragraphs option (shown only for such a
 * story, kept in prefs) turns it off for a row per line, as for every other text.
 *
 * Audio: one player is reused for every line. Play runs the text from the current line to the end
 * (`nextLine`); a line's replay button plays that line alone. Speed is the player's rate, with
 * pitch kept, so each line is one file whatever the speed. The audio session stays active between
 * lines (`keepAudioSessionActive`), or iOS can suspend the app in the gap with the screen locked,
 * and plays in the background while this screen is open. A line that fails to load counts as
 * finished, so Play moves on. When the playing line changes, the text scrolls to it if it's out of
 * view (`scrollTarget`).
 *
 * Loading: `/next` answers 202 while the server writes a text, so `load` asks again every few
 * seconds. `loadId` and `mounted` make a load that's been superseded (Next, then Back) drop its result.
 */

export type Tapped = { word: Word; x: number; y: number };

const POLL_MS = 3_000;
// Three attempts and the audio rarely take more than two minutes; past this, something is wrong.
const WRITE_WAIT_MS = 4 * 60_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A text from the shelf (`order`: the shelf's texts as they were listed, for Next; `playAll`: play
 * them one after another), a new text on a topic (practicing `words` when given, the cards just
 * studied), or a past text to read again.
 */
export type ReaderSource =
  | { kind: 'shelf'; textId: number; order: number[]; playAll?: boolean }
  | { kind: 'topic'; topic: { id: number; name: string }; words?: string[] }
  | { kind: 'past'; text: PastText };

type UpNext = { id: number; title: string; lines: number; order: number[] };

export function Reader({ api, source, settings, onSettings, onPlayWord, onNext, onDone, onOpenGrammar, mining }: {
  api: Api;
  source: ReaderSource;
  /** Opens a grammar point's page, from a line's explanation. */
  onOpenGrammar: (id: string) => void;
  /** Adding a selected phrase to the deck through the note editor; missing when there's no deck to add to. */
  mining?: PhraseMining;
  /** Plays a tapped word: its deck recording, else the phone's voice (useWordAudio). */
  onPlayWord: (word: string, language: Language) => void;
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
  const [tapped, setTapped] = useState<Tapped | null>(null);
  // A phrase being selected (its last word not tapped yet) or selected, explained under its line.
  const [phrase, setPhrase] = useState<PhrasePick | null>(null);
  // Grammar points marked from the popover while reading, by id (ReadGrammarNote).
  const [grammarChosen, setGrammarChosen] = useState<Record<string, GrammarChoice>>({});
  const chooseGrammar = (id: string, state: GrammarChoice) => setGrammarChosen((prev) => ({ ...prev, [id]: state }));
  const [ended, setEnded] = useState(false);
  const [rating, setRating] = useState<Rating | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [writing, setWriting] = useState(false);
  const [upNext, setUpNext] = useState<UpNext | null>(null);
  const [lengthStep, setLengthStep] = useState<LengthStep>('same');
  const [liked, setLiked] = useState<boolean | null>(null);
  const [steerError, setSteerError] = useState<string | null>(null);
  // A story episode's pick for what happens next (an index into text.choices), and why saving it failed.
  const [chosen, setChosen] = useState<number | null>(null);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const choiceSeq = useRef(0);
  // The length new texts were written at when this text opened, so Shorter and Longer step from it.
  const baseLength = useRef<Length>(settings?.lines ?? 8);
  const autoPlayed = useRef(false);
  const logged = useRef(false);
  const mounted = useRef(true);
  const loadId = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  // Listening goes on with the screen locked or in another app, while the reader is open. Review's
  // card audio doesn't need it, so it's turned off again on the way out.
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => undefined);
    return () => { setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(() => undefined); };
  }, []);

  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<number | null>(null);
  const [playingAll, setPlayingAll] = useState(false);
  // The line to shade: the one sounding now. `current` stays set after a pause or the end of a line
  // (Play and the "Line n of m" label need it), so shading it would leave a stopped line lit. Between
  // two lines of Play all the player is briefly not playing, so that gap keeps the shade too.
  const shaded = status.playing || status.isBuffering || (playingAll && status.didJustFinish) ? current : null;
  const [rate, setRate] = useState(prefs().rate);
  const [silentLine, setSilentLine] = useState<number | null>(null);
  // Plays per line (1 is off, Infinity is until turned off) and how many the current line has had in this round.
  const [repeat, setRepeat] = useState<number>(1);
  const [played, setPlayed] = useState(1);
  // The words being spoken in the line playing, lit as the voice reaches them (useSpokenWords.ts),
  // unless that's turned off in Read & Listen's settings. Read from prefs on each render rather than
  // kept in state, so a change made there shows here without reopening the text.
  // Only the line sounding now (`shaded`), so a paused or finished line doesn't keep a word lit.
  const playingWords = text && shaded !== null && prefs().followWords ? text.lines[shaded]?.words ?? null : null;
  const spokenNow = useSpokenWords(player, playingWords, status.playing);
  const spoken = new Set(playingWords ? spokenNow.map((i) => playingWords[i]) : []);

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

  useEffect(() => {
    const at = current === null ? -1 : paras ? rangeOf(paras, current) : current;
    const box = at < 0 ? undefined : lineBoxes.current[at];
    if (!box || !viewHeight.current) return;
    const insetTop = Math.max(0, headerHeight - viewTop.current);
    const y = scrollTarget(box, scrollY.current ?? -insetTop, { height: viewHeight.current, insetTop });
    if (y !== null) scroller.current?.scrollTo({ y, animated: true });
  }, [current]);

  const playLine = (i: number, all: boolean) => {
    if (!text) return;
    setSilentLine(null);
    player.replace(api.audioSource(text.id, i));
    player.setPlaybackRate(rate, 'high');
    player.play();
    setCurrent(i);
    setPlayed(1);
    setPlayingAll(all);
    setSession((s) => (s ? heard(s, rate) : s));
  };

  // Previous and next line, for a story with no play button on each line. Plays on from there.
  const skip = (step: -1 | 1) => {
    if (!text) return;
    const to = current === null ? firstLine(text.lines) : step < 0 ? previousLine(text.lines, current) : firstLine(text.lines, current + 1);
    if (to !== null) playLine(to, true);
  };

  const togglePlay = () => {
    if (!text) return;
    if (status.playing) player.pause();
    else if (current !== null && !status.didJustFinish && status.currentTime < status.duration) {
      player.setPlaybackRate(rate, 'high');
      player.play();
      setSession((s) => (s ? heard(s, rate) : s));
    } else {
      const start = firstLine(text.lines, current === null ? 0 : current + 1) ?? firstLine(text.lines);
      if (start !== null) playLine(start, true);
    }
  };

  const changeRate = (next: number) => {
    savePrefs({ rate: next });
    setRate(next);
    player.setPlaybackRate(next, 'high');
    if (status.playing) setSession((s) => (s ? heard(s, next) : s));
  };

  useEffect(() => {
    if (!status.didJustFinish || current === null || !text) return;
    const next = nextLine(text.lines, current, playingAll, repeat, played);
    if (next === current) {
      // The same source again: rewind rather than reload it.
      setPlayed((n) => n + 1);
      player.seekTo(0).then(() => player.play(), () => undefined);
      return;
    }
    if (next !== null) playLine(next, true);
    else {
      setPlayingAll(false);
      // Play all: the whole text has played, so it counts as read; on to the next one.
      // An episode that ends on a choice holds Play all, so the choice isn't skipped past.
      if (playingAll && source.kind === 'shelf' && source.playAll && !listenOnly && !holdsPlayAll(text, review)) playNext();
    }
  }, [status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a line ending only

  // A line whose audio didn't load (the server had none for it): note it and move on.
  useEffect(() => {
    if (!status.error || current === null || !text) return;
    setSilentLine(current);
    const next = nextLine(text.lines, current, playingAll);
    if (next !== null) playLine(next, true);
    else setPlayingAll(false);
  }, [status.error]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a load error only

  const load = async () => {
    const id = ++loadId.current;
    const stillWanted = () => mounted.current && id === loadId.current;
    player.pause();
    setCurrent(null);
    setPlayingAll(false);
    setSilentLine(null);
    setText(null);
    setError(null);
    setEnded(false);
    setRating(null);
    setWriting(false);
    setLineEnglish([]);
    // The next text is a different one: an explanation left open would ask the server for the
    // same line of it, and a gloss would sit over a word that's gone.
    setExplained([]);
    setTapped(null);
    setPhrase(null);
    setListenOnly(false);
    setUpNext(null);
    setLengthStep('same');
    setLiked(null);
    setSteerError(null);
    setChosen(null);
    setChoiceError(null);
    choiceSeq.current++;
    autoPlayed.current = false;
    baseLength.current = settings?.lines ?? 8;
    lineBoxes.current = [];
    scrollY.current = null; // back at the top, which is at minus the header's overlap
    logged.current = false;
    try {
      if (source.kind === 'past' || source.kind === 'shelf') {
        const opened = await api.text(source.kind === 'past' ? source.text.id : source.textId);
        if (!stillWanted()) return;
        setText(opened);
        setLiked(opened.liked ?? null);
        setChosen(opened.chosen ?? null);
        setSession(startSession(opened, Date.now()));
        return;
      }
      const topicId = source.topic.id;
      const deadline = Date.now() + WRITE_WAIT_MS;
      const words = source.words;
      let next = await api.nextText(topicId, words);
      while (next === null) {
        if (!stillWanted()) return;
        setWriting(true);
        if (Date.now() > deadline) throw new ApiError('Writing this text is taking longer than usual. Try again in a minute.', 0);
        await wait(POLL_MS);
        if (!stillWanted()) return;
        next = await api.nextText(topicId, words);
      }
      if (!stillWanted()) return;
      setText(next);
      setSession(startSession(next, Date.now()));
    } catch (e) {
      if (stillWanted()) setError(e instanceof ApiError ? e.message : "Couldn't get a text. Try again.");
    }
  };

  useEffect(() => { load(); }, [source]); // eslint-disable-line react-hooks/exhaustive-deps -- loads once per source

  // Play all starts each text playing as soon as it's open.
  useEffect(() => {
    if (!text || autoPlayed.current || source.kind !== 'shelf' || !source.playAll) return;
    autoPlayed.current = true;
    const start = firstLine(text.lines);
    if (start !== null) playLine(start, true);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps -- once per text

  // What Next opens: the next text in the shelf's order, else whatever the shelf has now (a text
  // written since). Looked up when the end view shows, and when Play all moves on.
  const findNext = async (): Promise<UpNext | null> => {
    if (source.kind !== 'shelf' || !text) return null;
    try {
      const shelf = await api.shelf();
      const order = playOrder(shelf).filter((id) => id !== text.id);
      const listed = nextInOrder(source.order, text.id);
      const id = listed !== null && order.includes(listed) ? listed : (order[0] ?? null);
      const card = [...(shelf.story?.next ? [shelf.story.next] : []), ...shelf.texts].find((t) => t.id === id);
      return card ? { id: card.id, title: card.title, lines: card.lines, order } : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (!ended || source.kind !== 'shelf') return;
    let live = true;
    findNext().then((n) => { if (live && mounted.current) setUpNext(n); });
    return () => { live = false; };
  }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps -- once per end view

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
      await api.logReading(text.id, toLog(session, Date.now(), null, true));
    } catch {
      // The reading is lost, not your place: carry on either way.
    }
    const next = await findNext();
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

  const chooseLiked = async (like: boolean) => {
    if (!text) return;
    const before = liked;
    setLiked(like);
    setSteerError(null);
    try {
      await api.setFavorite(text.topicId, like);
    } catch (e) {
      setLiked(before);
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
      setLeaving(true);
      try {
        await api.logReading(text.id, toLog(session, Date.now(), rating, true));
      } catch {
        // The reading is lost, not your place: carry on either way.
      } finally {
        if (mounted.current) setLeaving(false);
      }
    }
    if (!mounted.current) return;
    if (then === 'back') leave();
    else if (source.kind === 'shelf') {
      if (upNext) onNext({ kind: 'shelf', textId: upNext.id, order: upNext.order });
      else leave();
    } else load();
  };

  // A finished text is logged before the screen goes, however it goes: the Back button, the swipe,
  // or Back to topics. Without this a swipe skipped the log and the text stayed queued.
  const needsLog = !!text && !!session && (ended || session.listenOnly) && !review && !logged.current;
  const stopGuarding = usePreventRemove(needsLog || leaving, ({ repeat }) => { finish('back', repeat); });

  const tap = (word: Word, x: number, y: number) => {
    if (!session || !text) return;
    if (phrase && phrase.end === null) {
      // Choosing the phrase's last word: the tap ends the phrase, not a lookup.
      const at = locate(text.lines, word);
      if (at) setPhrase(pickEnd(phrase, at.line, at.index));
      return;
    }
    setSession(lookUp(session, word.text));
    setTapped({ word, x, y });
  };

  // A practice word's pill opens the same popover as the word in the text. Not while a phrase is
  // being picked, when a tap belongs to the phrase.
  const openPracticeWord = (text_: string, x: number, y: number) => {
    if (!session || !text || (phrase && phrase.end === null)) return;
    const word = text.lines.flatMap((l) => l.words).find((w) => w.text === text_);
    if (!word) return;
    setSession(lookUp(session, word.text));
    setTapped({ word, x, y });
  };

  // Holding a word and dragging to the last word of a phrase; held without dragging, it's a tap.
  const phraseDrag = usePhraseDrag({ lines: text?.lines ?? null, setPhrase, onHeld: tap });

  const startPhrase = () => {
    const at = tapped && text ? locate(text.lines, tapped.word) : null;
    if (!at) return;
    setPhrase({ line: at.line, start: at.index, end: null });
    setTapped(null);
  };

  // A word's part in the phrase: where it sits in the selected phrase, whether it's the first word
  // while the last is being chosen, and whether it's in a line the phrase can't reach.
  const phraseLook = (line: number, word: Word, words: Word[]) => {
    const here = phrase?.line === line ? words.indexOf(word) : -1;
    const picking = !!phrase && phrase.end === null;
    return {
      phrasePart: here >= 0 ? phrasePart(phrase, line, here) : null,
      phraseStart: picking && here === phrase.start,
      dimmed: picking && phrase.line !== line,
    };
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

  // The selected phrase's explanation, keyed by the phrase so a new one asks again. Not while
  // it's being dragged, or each word passed over would ask.
  const phraseCard = (pick: PhrasePick) => {
    if (!text) return null;
    const said = phraseText(text.lines[pick.line].words, pick);
    return (
      <PhraseExplanation
        key={`${pick.line}:${said}`}
        api={api}
        textId={text.id}
        line={pick.line}
        phrase={said}
        // Only into the deck of the language being read.
        mining={mining?.language === text.language ? mining : undefined}
        onClose={() => setPhrase(null)}
      />
    );
  };

  const seconds = session ? Math.round((Date.now() - session.startedAt) / 1000) : 0;
  const hasAudio = text ? firstLine(text.lines) !== null : false;

  return (
    <Screen
      largeTitle={false}
      toolbar={text && !ended && !listenOnly ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="slider.horizontal.3" accessibilityLabel="Reading options">
            <Stack.Toolbar.MenuAction isOn={english} onPress={() => setEnglish(!english)}>Show English</Stack.Toolbar.MenuAction>
            {marked ? (
              <Stack.Toolbar.MenuAction isOn={paragraphMode} onPress={() => turnOnParagraphs(!paragraphMode)}>Paragraphs</Stack.Toolbar.MenuAction>
            ) : null}
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
          {phrase && phrase.end === null && !listenOnly ? (
            <PhrasePickBanner first={text.lines[phrase.line]?.words[phrase.start]?.text ?? ''} onCancel={() => setPhrase(null)} />
          ) : null}
          {hasAudio ? (
            <PlayerBar playing={status.playing} current={current} total={text.lines.length} what={text.form === 'story' ? 'story' : 'dialogue'} skippable={paras !== null} onSkip={skip}
              rate={rate} repeat={repeat} played={played} silentLine={silentLine} onToggle={togglePlay} onRate={changeRate} onRepeat={() => { setRepeat((r) => nextRepeatCount(r)); setPlayed(1); }} />
          ) : <Help>No audio for this text.</Help>}
        </>
      ) : undefined}
    >
      {/* Centered in the whole screen frame, which runs under the native header. The automatic inset
          would add the header's height on top of that centering and push the spinner below the middle. */}
      {!text ? (
        <ScrollView contentInsetAdjustmentBehavior="never" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          {error ? (
            <View style={{ padding: space.l }}><ErrorNote message={error} onRetry={load} /></View>
          ) : (
            <View style={{ padding: space.xxl, alignItems: 'center', gap: space.m }}>
              <ActivityIndicator color={c.accent} />
              <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
                {writing ? 'Writing a text. This takes about half a minute.' : 'Opening the text'}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      {text && session && !ended ? (
        <ScrollView
          ref={scroller}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: space.l }}
          onLayout={(e) => {
            viewHeight.current = e.nativeEvent.layout.height;
            scroller.current?.measureInWindow((_x, y) => { viewTop.current = y; });
          }}
          onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={100}
          // Off while a phrase is dragged, or the scroll takes the finger back on its first move.
          scrollEnabled={!phraseDrag.dragging}
        >
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.l }}>
            <View style={{ gap: space.xs }}>
              <Text style={{ ...type.title, color: c.text }}>{text.title}</Text>
              <Text style={{ ...type.footnote, color: c.textSecondary }}>
                {text.episode ? `${text.topic} · Episode ${text.episode}` : (text.topic ?? (source.kind === 'topic' ? source.topic.name : source.kind === 'past' ? source.text.topic : ''))}
              </Text>
            </View>
            {text.stretch.length > 0 || practicedGrammar(text).length > 0 || keyMarks.length > 0 ? (
              <Card style={{ padding: space.m, gap: space.m }}>
                {text.stretch.length > 0 ? (
                  <ChipRow label="Practice words">
                    {text.stretch.map((w) => <Pill key={w} text={w} bg={c.accentFill} fg={c.accent} onPress={(x, y) => openPracticeWord(w, x, y)} />)}
                  </ChipRow>
                ) : null}
                {practicedGrammar(text).length > 0 ? (
                  <ChipRow label="Grammar">
                    {practicedGrammar(text).map((g) => <Pill key={g.id} text={g.name} bg={c.speakerB} fg={c.onSpeakerB} />)}
                  </ChipRow>
                ) : null}
                <ReaderKey examples={keyMarks} language={text.language ?? 'th'} textStyle={readStyle(text, thaiFont)} shown={markShown} onChange={showMark} />
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
            {source.kind === 'past' && !listenOnly && source.text.rating === 'about_right' && hasAudio ? (
              <ToggleRow label="You rated this about right">
                <HeaderAction label="Listen without the text" onPress={listenWithoutText} />
              </ToggleRow>
            ) : null}
            {listenOnly ? (
              <ToggleRow label="Listening without the text">
                <HeaderAction label="Show the text" onPress={() => setListenOnly(false)} />
              </ToggleRow>
            ) : (
              <>
                {highlight && countOutsideDeck(text) === 0 ? (
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>Every word in this text is in your deck.</Text>
                ) : null}
                {underFloor(text) ? (
                  <Card style={{ padding: space.m, gap: space.s }}>
                    <Help>{`${Math.round(text.coverage * 100)}% of the words in this one are in your deck, fewer than usual. Tap any word for its meaning.`}</Help>
                    {highlight ? null : <View style={{ alignItems: 'flex-start' }}><HeaderAction label="Highlight them" onPress={() => turnOnHighlight(true)} /></View>}
                  </Card>
                ) : null}
              </>
            )}
          </View>
          {paras ? paras.map((range, g) => {
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
                {listenOnly ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, paddingVertical: space.s }}>{`Paragraph ${g + 1}`}</Text>
                ) : (
                  <View {...phraseDrag.lineProps} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {lines.map((l, k) => (
                      <React.Fragment key={k}>
                        {k > 0 ? <View style={{ width: readStyle(text, thaiFont).fontSize * 0.5 }} /> : null}
                        {wrapGroups(l.words).map((chunk, j) => (
                          <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {chunk.map((word, m) => (
                              <WordView
                                key={m}
                                word={word}
                                textStyle={readStyle(text, thaiFont)}
                                grammar={grammarOf(text, word)}
                                flagged={isFlagged(session, word.text)}
                                highlighted={highlight && isOutsideDeck(word)}
                                named={markNames && isName(word)}
                                selected={tapped?.word === word}
                                hidden={hiddenMarks}
                                {...phraseLook(range.start + k, word, l.words)}
                                playing={shaded === range.start + k}
                                spoken={spoken.has(word)}
                                onPress={tap}
                                onLongPress={phraseDrag.begin}
                                viewRef={phraseDrag.wordRef(word)}
                              />
                            ))}
                          </View>
                        ))}
                      </React.Fragment>
                    ))}
                  </View>
                )}
                {!listenOnly && english ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, marginTop: space.xs }}>{lines.map((l) => l.english).join(' ')}</Text>
                ) : null}
                {!listenOnly && !phraseDrag.dragging && phrase && phrase.end !== null && phrase.line >= range.start && phrase.line <= range.end
                  ? phraseCard(phrase) : null}
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
                borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
                backgroundColor: shaded === i ? c.surface : undefined,
              }}
            >
              {line.speaker === 'N' ? null : (
                // Centered on the first line of words, which is a word's line height plus its
                // padding and underline border (4.5) tall; the speaker's mark is `speakerSize` tall.
                <View style={{ paddingTop: listenOnly ? space.s : Math.max(0, (readStyle(text, thaiFont).lineHeight + 4.5 - speakerSize(text, line.speaker)) / 2) }}>
                  <Speaker text={text} who={line.speaker} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                {listenOnly ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, paddingVertical: space.s }}>
                    {(line.speaker !== 'N' && text.roles[line.speaker]) || `Line ${i + 1}`}
                  </Text>
                ) : (
                  <View {...phraseDrag.lineProps} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
                    {wrapGroups(line.words).map((group, j) => (
                      // A line breaks only between groups, so punctuation never wraps away from its word.
                      <View key={j} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        {group.map((word, k) => (
                          <WordView
                            key={k}
                            word={word}
                            textStyle={readStyle(text, thaiFont)}
                            grammar={grammarOf(text, word)}
                            flagged={isFlagged(session, word.text)}
                            highlighted={highlight && isOutsideDeck(word)}
                            named={markNames && isName(word)}
                            selected={tapped?.word === word}
                            hidden={hiddenMarks}
                            {...phraseLook(i, word, line.words)}
                            spoken={spoken.has(word)}
                            onPress={tap}
                            onLongPress={phraseDrag.begin}
                            viewRef={phraseDrag.wordRef(word)}
                          />
                        ))}
                      </View>
                    ))}
                  </View>
                )}
                {/* Under the words, above anything they reveal, so a button doesn't move when English or an explanation opens. */}
                <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.s }}>
                  {line.audio ? (
                    <RoundButton icon="play.fill" accessibilityLabel={`Play line ${i + 1}`} on onPress={() => playLine(i, false)} />
                  ) : null}
                  {!english && !listenOnly ? (
                    <RoundButton
                      label="EN"
                      accessibilityLabel={lineEnglish.includes(i) ? `Hide English for line ${i + 1}` : `Show English for line ${i + 1}`}
                      on={lineEnglish.includes(i)}
                      onPress={() => toggleLineEnglish(i)}
                    />
                  ) : null}
                  {!listenOnly ? (
                    <RoundButton
                      icon="sparkles"
                      accessibilityLabel={explained.includes(i) ? `Hide explanation for line ${i + 1}` : `Explain line ${i + 1}`}
                      on={explained.includes(i)}
                      onPress={() => toggleExplained(i)}
                    />
                  ) : null}
                  {!listenOnly ? <RegisterChip register={line.register} /> : null}
                </View>
                {!listenOnly && (english || lineEnglish.includes(i)) ? (
                  <Text style={{ ...type.subhead, color: c.textSecondary, marginTop: 2 }}>{line.english}</Text>
                ) : null}
                {!listenOnly && explained.includes(i) ? <LineExplanation api={api} textId={text.id} line={i} grammarChosen={grammarChosen} onGrammarChosen={chooseGrammar} onOpenGrammar={onOpenGrammar} /> : null}
                {!listenOnly && !phraseDrag.dragging && phrase && phrase.end !== null && phrase.line === i ? phraseCard(phrase) : null}
              </View>
            </View>
          ))}
          {!listenOnly && choicesView(text, review) ? (
            <View style={{ paddingHorizontal: space.l, paddingBottom: space.l }}>
              <ReadChoices choices={text.choices ?? []} chosen={chosen} textStyle={readStyle(text, thaiFont)} onChoose={review ? null : choose} error={choiceError} />
            </View>
          ) : null}
          {review ? null : (
            <View style={{ padding: space.l }}>
              <Button label="Done" onPress={() => { player.pause(); setEnded(true); }} />
            </View>
          )}
        </ScrollView>
      ) : null}

      {text && session && ended ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.m }}>
          <Card style={{ gap: space.s }}>
            <Text style={{ ...type.title, color: c.text }}>How was this one?</Text>
            <Help>Your answer sets how hard the next text is.</Help>
            <View accessibilityRole="radiogroup" style={{ gap: space.s }}>
              {RATINGS.map((r) => {
                const selected = rating === r.value;
                return (
                  <Tappable
                    key={r.value}
                    onPress={() => { haptic.select(); setRating(selected ? null : r.value); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${r.label}. ${r.hint}`}
                    scaleTo={0.98}
                    style={{
                      borderWidth: 1, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.m, gap: 2,
                      borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accentFill : undefined,
                    }}
                  >
                    <Text style={{ ...type.headline, color: selected ? c.accent : c.text }}>{r.label}</Text>
                    <Text style={{ ...type.footnote, color: selected ? c.accent : c.textSecondary }}>{r.hint}</Text>
                  </Tappable>
                );
              })}
            </View>
          </Card>
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Stat value={`${Math.round(text.coverage * 100)}%`} label="Words you know" />
            <Stat value={String(session.glossed.length)} label="Words looked up" />
            <Stat value={formatDuration(seconds)} label="Time" />
          </View>
          {session.flagged.length > 0 ? (
            <Card style={{ gap: 0 }}>
              <Text style={{ ...type.headline, color: c.text, paddingBottom: space.s }}>Marked as unknown</Text>
              {session.flagged.map((w, i) => (
                <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                  <Text style={{ ...type.body, color: c.text }}>{w}</Text>
                  <Text style={{ ...type.subhead, color: c.textSecondary, flex: 1 }}>{glossFor(text, w) ?? ''}</Text>
                </View>
              ))}
              <View style={{ paddingTop: space.s }}><Help>These are kept in Marked words, where the ones not in your deck can be added to it.</Help></View>
            </Card>
          ) : null}
          {source.kind === 'shelf' ? (
            <Card style={{ gap: space.m }}>
              <View style={{ gap: 2 }}>
                <Text style={{ ...type.headline, color: c.text }}>For the next ones</Text>
                <Help>Changes the texts written from now on. Texts already on the shelf stay as they are.</Help>
              </View>
              <View style={{ gap: space.xs }}>
                <Text style={{ ...type.footnote, color: c.textSecondary }}>Length</Text>
                <Segments<LengthStep>
                  options={[{ value: 'shorter', label: 'Shorter' }, { value: 'same', label: 'Same' }, { value: 'longer', label: 'Longer' }]}
                  value={lengthStep}
                  onChange={chooseLength}
                />
              </View>
              {liked !== null && !text.episode ? (
                <View style={{ gap: space.xs }}>
                  <Text style={{ ...type.footnote, color: c.textSecondary }}>{`This theme: ${text.topic}`}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                    <Chip label="More like this" selected={liked} onPress={() => chooseLiked(true)} />
                    <Chip label="Fewer like this" selected={!liked} onPress={() => chooseLiked(false)} />
                  </View>
                </View>
              ) : null}
              {steerError ? <ErrorNote message={steerError} /> : null}
            </Card>
          ) : null}
          {rating === 'about_right' && hasAudio ? (
            <View style={{ gap: space.xs }}>
              <Button label="Listen without the text" variant="secondary" onPress={listenWithoutText} />
              <Help>Plays it again with the text hidden.</Help>
            </View>
          ) : null}
          {source.kind === 'shelf' ? (
            upNext ? (
              <View style={{ gap: space.xs }}>
                <Button label={`Next: ${upNext.title}`} onPress={() => finish('next')} busy={leaving} />
                <Help>{`About ${minutesFor(upNext.lines)} min.`}</Help>
              </View>
            ) : null
          ) : <Button label="Next text" onPress={() => finish('next')} busy={leaving} />}
          <Button label={review ? 'Back to the list' : 'Save and back to the shelf'} variant={source.kind === 'shelf' && !upNext ? 'primary' : 'secondary'} onPress={() => finish('back')} />
        </ScrollView>
      ) : null}

      <GlossPopover
        tapped={tapped}
        grammar={tapped && text ? grammarOf(text, tapped.word) : null}
        api={api}
        grammarChosen={grammarChosen}
        onGrammarChosen={chooseGrammar}
        flagged={tapped && session ? isFlagged(session, tapped.word.text) : false}
        onToggleFlag={review ? null : () => { if (tapped && session) setSession(toggleFlag(session, tapped.word.text)); }}
        onPlay={() => {
          if (!tapped || !text) return;
          // The word and the line would talk over each other.
          player.pause();
          onPlayWord(tapped.word.text, text.language);
        }}
        onSelectPhrase={listenOnly ? null : startPhrase}
        onAddToDeck={mining?.language === text?.language && mining && tapped && !tapped.word.deck && tapped.word.status !== 'name' ? () => {
          // The popover is a modal, so it closes before the note editor opens over the reader.
          const word = tapped.word.text;
          setTapped(null);
          void mining.onAdd(word, tapped.word.gloss ?? "").then((saved) => {
            // In the deck now, so no longer marked unknown.
            if (saved) setSession((s) => (s && isFlagged(s, word) ? toggleFlag(s, word) : s));
          });
        } : null}
        onClose={() => setTapped(null)}
      />
    </Screen>
  );
}

const RATINGS: { value: Rating; label: string; hint: string }[] = [
  { value: 'too_easy', label: 'Too easy', hint: 'More new words next time' },
  { value: 'about_right', label: 'About right', hint: 'Keep it like this' },
  { value: 'too_hard', label: 'Too hard', hint: 'Fewer new words next time' },
];

/** The reading size for a text's language. */
function readStyle(text: ReaderText, thaiFont: ThaiFont) {
  const language = text.language ?? 'th';
  const info = LANGUAGES[language];
  return { fontSize: info.fontSize, lineHeight: info.fontSize * info.lineHeight, font: readFont(language, thaiFont) };
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

function Pill({ text, bg, fg, onPress }: { text: string; bg: string; fg: string; onPress?: (x: number, y: number) => void }) {
  const pill = (
    <Text style={{ ...type.subhead, fontWeight: '700', color: fg, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: space.xs, borderRadius: radius.pill, overflow: 'hidden' }}>
      {text}
    </Text>
  );
  if (!onPress) return pill;
  return (
    <Tappable
      onPress={(e) => onPress(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      accessibilityRole="button"
      accessibilityLabel={`Meaning of ${text}`}
    >
      {pill}
    </Tappable>
  );
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

/** A line's replay and EN buttons: a full tap target, filled when on. One of `icon` or `label`. */
function RoundButton({ icon, label, accessibilityLabel, on, onPress }: {
  icon?: SFSymbol;
  label?: string;
  accessibilityLabel: string;
  on: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const fg = on ? c.accent : c.textSecondary;
  return (
    <Tappable
      onPress={() => { haptic.tap(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scaleTo={0.92}
      style={{
        minWidth: MIN_TAP, minHeight: MIN_TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
        backgroundColor: on ? c.accentFill : c.fill,
      }}
    >
      {icon ? <Icon name={icon} size={16} color={fg} weight="semibold" /> : <Text style={{ ...type.footnote, fontWeight: '700', color: fg }}>{label}</Text>}
    </Tappable>
  );
}

const POPOVER_WIDTH = 290;
// Space between the tap and the popover's edge, enough to clear the tapped word.
const POPOVER_GAP = 28;

export function GlossPopover({ tapped, grammar, api, grammarChosen, onGrammarChosen, flagged, onToggleFlag, onPlay, onSelectPhrase, onAddToDeck, onClose }: {
  tapped: Tapped | null;
  grammar: TextGrammar | null;
  api: Api;
  grammarChosen: Record<string, GrammarChoice>;
  onGrammarChosen: (id: string, state: GrammarChoice) => void;
  flagged: boolean;
  onPlay: () => void;
  /** null when marking isn't recorded (reading a past text). */
  onToggleFlag: (() => void) | null;
  /** Starts selecting a phrase from this word, to have it explained. */
  onSelectPhrase: (() => void) | null;
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
  // The transliteration stays hidden until asked for, and hides again for the next word.
  const [showTranslit, setShowTranslit] = useState(false);
  useEffect(() => { setPopHeight(0); setShowTranslit(false); }, [tapped]);
  if (!tapped) return null;
  const popWidth = Math.min(POPOVER_WIDTH, width - 2 * space.l);
  const left = Math.min(Math.max(tapped.x - 40, space.l), width - popWidth - space.l);
  // Above the word when it clears the status bar, so the finger and the word both stay visible;
  // otherwise below it, and never past the bottom edge.
  const above = tapped.y - POPOVER_GAP - popHeight;
  const top = Math.min(above >= insets.top + space.s ? above : tapped.y + POPOVER_GAP, height - popHeight - insets.bottom - space.s);
  const actions: Parameters<typeof WordActionRow>[0][] = [];
  if (tapped.word.translit && !showTranslit) actions.push({ icon: 'eye', label: 'Show transliteration', onPress: () => setShowTranslit(true) });
  if (onSelectPhrase) actions.push({ icon: 'text.cursor', label: 'Select a phrase', accessibilityLabel: `Select a phrase starting from ${tapped.word.text}`, onPress: onSelectPhrase });
  if (onAddToDeck) actions.push({ icon: 'plus.circle', label: 'Add to deck', accessibilityLabel: `Add ${tapped.word.text} to your deck`, onPress: onAddToDeck });
  if (onToggleFlag) actions.push({ icon: flagged ? 'flag.slash' : 'flag', label: flagged ? 'Unmark' : 'Mark as unknown', onPress: onToggleFlag, chevron: false });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        onLayout={(e) => setPopHeight(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute', top, left, width: popWidth, opacity: popHeight > 0 ? 1 : 0,
          backgroundColor: c.surface, borderColor: c.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.l,
          padding: space.l, gap: space.xs, ...lift(c, 'high'),
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.m }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={{ ...type.title, color: c.text }}>{tapped.word.text}</Text>
            {tapped.word.lemma ? <Text style={{ ...type.footnote, color: c.textSecondary }}>Dictionary form: {tapped.word.lemma}</Text> : null}
            <Text style={{ ...type.body, color: c.text }}>{tapped.word.gloss ?? 'No meaning available'}</Text>
            {tapped.word.translit && showTranslit ? <Text style={{ ...type.body, color: c.textSecondary }} selectable>{tapped.word.translit}</Text> : null}
            <Text style={{ ...type.footnote, color: c.textSecondary }}>{wordStatus(tapped.word)}</Text>
          </View>
          <WordPlayButton onPress={onPlay} />
        </View>
        {grammar ? <ReadGrammarNote grammar={grammar} api={api} chosen={grammarChosen[grammar.id]} onChosen={onGrammarChosen} /> : null}
        {actions.length > 0 ? (
          <WordActionGroup>
            {actions.map((a, i) => <WordActionRow key={a.label} first={i === 0} {...a} />)}
          </WordActionGroup>
        ) : null}
      </View>
    </Modal>
  );
}

function PlayerBar({ playing, current, total, what, skippable, onSkip, rate, repeat, played, silentLine, onToggle, onRate, onRepeat }: {
  playing: boolean;
  current: number | null;
  total: number;
  what: 'dialogue' | 'story';
  /** Previous and next line buttons, for a story with no play button on each line. */
  skippable: boolean;
  onSkip: (step: -1 | 1) => void;
  rate: number;
  /** Plays per line: 1 is off, Infinity is until turned off. */
  repeat: number;
  /** How many times the current line has played in this round. */
  played: number;
  silentLine: number | null;
  onToggle: () => void;
  onRate: (rate: number) => void;
  onRepeat: () => void;
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
  const label = (
    <View style={{ flex: 1 }}>
      <Text style={{ ...type.subhead, fontWeight: '600', color: c.text }}>{current === null ? `Play the ${what}` : `Line ${current + 1} of ${total}`}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>
        {silentLine !== null ? `Line ${silentLine + 1} has no audio.` : repeating ? repeatNote : skippable ? 'Tap a word for its meaning' : "Tap a line's play button to replay it"}
      </Text>
    </View>
  );
  // One tap steps Off, 2×, 3×, 5×, ∞ (playback.ts), so the choices share one chip.
  const chip = (
    <Tappable
      onPress={() => { haptic.select(); onRepeat(); }}
      accessibilityRole="button"
      accessibilityLabel="Repeat line"
      accessibilityValue={{ text: repeating ? (repeat === Infinity ? 'Until turned off' : `${repeat} times`) : 'Off' }}
      scaleTo={0.95}
      style={{
        minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.m, borderRadius: radius.pill,
        backgroundColor: repeating ? c.accentFill : c.fill,
      }}
    >
      <Icon name="repeat" size={14} color={repeating ? c.accent : c.textSecondary} weight="semibold" />
      <Text style={{ ...type.footnote, fontWeight: '600', color: repeating ? c.accent : c.textSecondary }}>{repeatChipLabel(repeat)}</Text>
    </Tappable>
  );
  return (
    <View style={{ gap: space.m }}>
      {skippable ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
            <SkipButton icon="backward.end.fill" label="Previous line" onPress={() => onSkip(-1)} />
            {play}
            <SkipButton icon="forward.end.fill" label="Next line" onPress={() => onSkip(1)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>{label}{chip}</View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>{play}{label}{chip}</View>
      )}
      <Segments options={RATES.map((r) => ({ value: r, label: `${r.toFixed(1)}×`, accessibilityLabel: `Speed ${r}` }))} value={rate} onChange={onRate} />
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
    <View style={{ flex: 1, backgroundColor: c.surface, borderColor: c.border, borderWidth: 1, borderRadius: radius.m, padding: space.m }}>
      <Text style={{ ...type.title, color: c.text }}>{value}</Text>
      <Text style={{ ...type.caption, color: c.textSecondary }}>{label}</Text>
    </View>
  );
}
