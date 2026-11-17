import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Keyboard, Pressable, ScrollView, Text, TextInput, useColorScheme, View } from 'react-native';
import { FLAG_NAMES, noteCards, type CardState } from '../core/cardState';
import { AGENT_FLAG, withFlagReason } from '../core/agentFlag';
import { autoplayFor, canRecordYourself, isOmnilanguage, playbackFor, renderCard, type Playback } from '../core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../core/config';
import { cardDeck, cardHomeDeck, isInDeck, queueInput, treeQueue } from '../core/deckTree';
import { failureText } from '../core/failure';
import { boostFor } from '../core/priority';
import { nextStudyDayStart, studyDayKey, studyDayStart } from '../core/day';
import { dueCounts, isInterdayLearning, nextLearningDue, siblingsToBury, studiedKind, studiedToday, type StudiedToday } from '../core/queue';
import { ratingsShown, type AnswerButtons } from '../core/answerButtons';
import { becameLeech, DEFAULT_LEARN_STEPS, DEFAULT_LEECH, DEFAULT_RELEARN_STEPS, paramsForDeck, previewIntervals, previewLog, review, type AnswerContext, type RatingValue } from '../core/scheduler';
import { fuzzSeed } from '../core/ankiFuzz';
import { balancerFor, buildLoadSnapshot, forgetCard, loadDayIndex, recordAnswer, type LoadSnapshot } from '../core/loadBalance';
import { ankiToday, fnvHash } from '../core/order';
import { saveLeechHint, saveNote, setCardStates, type NoteStore } from '../anki/noteService';
import { forgetCards, setDueDates } from '../anki/rescheduleService';
import { parseDueDate } from '../core/reschedule';
import { DEFAULT_THAI_TEXT_SIZE, type ThaiTextSize } from '../core/script';
import { answerTimeMs, bumpStudied, currentCard, sessionProgress, sessionSummary, type AnswerRecord } from '../core/session';
import { reviewWrites } from '../core/writeQueue';
import { durationText } from '../core/stats';
import { wantedLines } from '../core/synonyms';
import { cardDocument, renderTemplateCard, sideAudio } from '../core/template';
import type { TtsTag } from '../core/tts';
import type { Card, CollectionSettings, DeckParams, DeckSettings, Note, NoteType } from '../core/types';
import type { AnkiUndo } from '../anki/writeback';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { mediaBaseUri, mediaFileUri } from '../media/mediaFiles';
import { mathjaxUri } from '../media/mathjax';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardWebView } from './CardWebView';
import { Side } from './CardSide';
import { CardStateChips } from './CardStateChips';
import { MemoryStrength } from './MemoryStrength';
import { fragilePercent } from '../core/memoryStrength';
import { stateChip } from '../core/stateChip';
import { isLeechNote } from '../core/trouble';
import { useCardGlosses, type CardGlossing } from './useCardGlosses';
import { useVacationPrefs } from './vacationPrefs';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { practiceWords } from '../reader/practice';
import { wordsToUse, type WordToUse } from '../reader/production';
import { headword, type DrillRequest } from '../core/forms';
import { AnswerExtras, FormsCheck, useReviewForms } from './ReviewForms';
import { haptic } from './haptics';
import { RecordYourself } from './RecordYourself';
import { useSelfRecording } from './useSelfRecording';
import { htmlToText } from '../core/html';
import { chooseAgentFlagReason } from './agentFlagSheet';
import { LeechHintSheet } from './LeechHintSheet';
import { AskCardSheet } from './AskCardSheet';
import { cardForClaude, withNotesAnswer, type AskTurn, type CardForClaude } from '../core/askCard';
import { canAddMnemonic, mnemonicQuestion, type MnemonicQuestion } from '../core/leechHint';
import { PLAY_BUTTON_CLEARANCE, PlayButton } from './PlayButton';
import { usePhoneSpeech } from './usePhoneSpeech';
import { missReasonsFor, missReminder } from '../core/misses';
import { AgainSplit, MissReminder } from './MissMarks';
import { useMissMarks } from './useMissMarks';
import { CONFUSED_REASON } from '../core/confusedPairs';
import { canLinkConfused, ConfusedLinkSheet, ConfusedRow } from './ConfusedLink';
import { useConfusedPairs } from './useConfusedPairs';
import { OwnHookField, TypeItButton, useOwnHook } from './ReviewActive';
import { ListeningNote, SpeakButton } from './SpeakButton';
import { spokenAnswerNote } from '../core/speaking';
import { keyboardLanguageForText } from '../core/keyboardLanguage';
import { stripExpected } from '../core/typeAnswer';
import { useKeyboardLanguage } from './useKeyboardLanguage';
import { useSpokenAnswer } from './useSpokenAnswer';
import { languageName } from '../core/voices';
import { TypedDiff } from './TypedDiff';
import { SessionMissList, useSessionMisses, type MixupRequest } from './SessionMisses';
import { ReviewMenu } from './ReviewMenu';
import { NextSteps, type NextStep } from './ReviewNextSteps';
import { asksOwnHook, typeItAnswer } from '../core/activeRecall';
import { compareTyped } from '../core/typedCompare';
import { Button, Count, Icon, Loading, ProgressBar, Screen, Tappable } from './kit';
import { CountingText, Pop, Reveal, useReduceMotion } from './motion';
import { ChangeRatingStrip, useRatingOffer } from './ChangeRating';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';
import { useHeaderInset } from './useHeaderInset';

import { CardSurface, SwipeCard, type CardMotion } from './SwipeCard';
export { CardSurface };

/** The audio mode Review plays in (AppContext's), put back after Record yourself records. */
const AUDIO_MODE = { playsInSilentMode: true };

/** What this session did, shown when the queue is empty: cards answered, time, and how many were Again. */
function SessionSummary({ history, delay = 0 }: { history: AnswerRecord[]; delay?: number }) {
  const c = useTheme();
  const { answered, again, takenMs } = sessionSummary(history);
  // The counts run up from 0 once the summary has appeared (the end of a session is a small payoff).
  const [counting, setCounting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setCounting(true), delay + 80); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tile = (value: string | number, label: string) => (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      {typeof value === 'number'
        ? <CountingText value={counting ? value : 0} style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }} />
        : <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Text>}
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={`This session: ${answered} ${answered === 1 ? 'card' : 'cards'}, ${durationText(takenMs)}, ${again} answered Again`}
      style={{ flexDirection: 'row', alignSelf: 'stretch', marginTop: space.xl, paddingVertical: space.l, borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border }}
    >
      {tile(answered, answered === 1 ? 'card' : 'cards')}
      {tile(durationText(takenMs), 'studying')}
      {tile(again, 'Again')}
    </View>
  );
}

/**
 * Studies `deck` and its subdecks. Each card is scheduled with its own deck's FSRS settings, and
 * every deck's daily limits apply (`treeQueue`). Omnilanguage cards render natively with TTS;
 * other note types render their Anki templates in a WebView.
 */
export function Review({ repo, deck, practice, extraCard, suggestHints, askAboutCard, glossing, reloadKey, onDone, onEditNote, onPracticeForms, onPracticeMixups, onNextDeck, nextDeck, onEarlierDeck, earlierDeck, onCustomStudy, onCardInfo }: {
  repo: Repo & AnkiLink;
  deck: string;
  /**
   * Present when the deck is a Read & Listen language's (src/reader/practice.ts): once the session
   * ends, it offers a text that practices the words just studied.
   */
  practice?: { languageDeck: string; onRead: (words: string[]) => Promise<void>; onUseWords?: (words: WordToUse[]) => void };
  /** Today's extra for this deck's language (DailyExtras.tsx), shown above the next steps when the session ends. */
  extraCard?: React.ReactNode;
  /** Present while Read & Listen is signed in: asks its server for memory hints, when a leech's hint sheet asks for them. */
  suggestHints?: (question: MnemonicQuestion) => Promise<string[]>;
  /** Present while Read & Listen is signed in: answers a question typed about the card on screen (AskCardSheet). */
  askAboutCard?: (card: CardForClaude, turns: AskTurn[]) => Promise<string>;
  /** Present while Read & Listen is signed in: an example sentence's words can be tapped for their meanings (useCardGlosses). */
  glossing?: CardGlossing;
  /** Changes when something outside this screen may have changed the deck (custom study): loads the cards again. */
  reloadKey?: number;
  /** Leaves the screen: the deck is done. */
  onDone: () => void;
  /** Opens the note editor over this screen, calling `onClose` with what happened. */
  onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  /** Opens a forms drill (src/ui/FormsDrill.tsx) over this screen. */
  onPracticeForms: (request: DrillRequest) => void;
  /** Opens Similar words (src/ui/tools/MixupsTool.tsx) on words missed this session. */
  onPracticeMixups?: (request: MixupRequest) => void;
  /** Replaces this screen with the next deck in the list that has cards to study; absent when there is none. */
  onNextDeck?: () => void;
  /** That deck's name, for the button. */
  nextDeck?: string;
  /** Replaces this screen with the first deck at the top of the list that still has cards; only given when there is no next deck. */
  onEarlierDeck?: () => void;
  /** That deck's name, for the button. */
  earlierDeck?: string;
  /** Opens Custom Study for this deck (src/ui/CustomStudy.tsx), which can raise today's limits or pick more cards to study. */
  onCustomStudy: () => void;
  /** Opens Card Info (src/ui/CardInfo.tsx) for a card. */
  onCardInfo: (cardId: string) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [cards, setCards] = useState<Card[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  // The answer that just made a card a leech asks for a hint to keep in its note's Mnemonic field,
  // and names the card when that answer suspended it, so saving a hint can bring it back.
  // The same sheet opens from Write a mnemonic in the ⋯ menu, with no misses to report.
  const [leechPrompt, setLeechPrompt] = useState<{ noteId: string; misses?: number; suspendedCardId?: string } | null>(null);
  // The Ask Claude sheet, from the ⋯ menu: the card it was opened for, as text.
  const [askCard, setAskCard] = useState<CardForClaude | null>(null);
  const [studied, setStudied] = useState<Map<string, StudiedToday>>(new Map());
  const [allParams, setAllParams] = useState<Map<string, DeckParams>>(new Map());
  // While "Read a text with these words" waits for the sync that sends today's answers first.
  const [openingText, setOpeningText] = useState(false);
  const openingRef = useRef(false); // set at once, where the state only shows after a render
  // The Anki collection's day start, learn-ahead limit and v3 options.
  const [collection, setCollection] = useState<CollectionSettings>(DEFAULT_COLLECTION_SETTINGS);
  const H = collection.dayStartsAtHour;
  const [answerButtons, setAnswerButtons] = useState<AnswerButtons>('all');
  const [swipeOn, setSwipeOn] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>(DEFAULT_THAI_TEXT_SIZE);
  // Bumped after the note editor saves or deletes, to load the cards and notes again.
  const [reloads, setReloads] = useState(0);
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [deckSettings, setDeckSettings] = useState<Map<string, DeckSettings>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [preferId, setPreferId] = useState<string>();
  // The strip offering to change the last answer to Again (ChangeRating.tsx), and the card it's undone for.
  const ratingOffer = useRatingOffer();
  const [againFor, setAgainFor] = useState<string | null>(null);
  // Set while an answer or an undo is being written. A second tap during the await would
  // otherwise act on the same card again from its old state.
  const busy = useRef(false);
  // The card's motion (SwipeCard's): an undo brings the card back in from the side, and an answer flashes its color.
  const cardMotion = useRef<CardMotion | null>(null);
  const rating = useRef(false);
  // The card last answered, as it was shown. `busy` is cleared before React has drawn the next card,
  // so a tap landing in between still sees this one: it mustn't be answered twice from its old state.
  const lastAnswered = useRef<Card | null>(null);
  // Counts each write's start and end (an answer, an undo, a card change). A load that saw it move
  // read the cards from before that write, so it's read again rather than put back over the write.
  const writes = useRef(0);
  // The study day the last load counted today's answers for.
  const loadedDay = useRef<string | null>(null);
  // Anki's load balancer works from a snapshot of the days ahead, taken when the session is built.
  const loadSnapshot = useRef<LoadSnapshot>(new Map());

  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    setLoadError(null);
    let stale = false;
    (async () => {
      // Answers still being written (Review's queue) are in the database before it's read.
      await reviewWrites.idle();
      const seen = writes.current;
      const now = new Date();
      const cs = await repo.collectionSettings();
      const dayStart = studyDayStart(now, cs.dayStartsAtHour);
      const [c, n, reviews, revlog, params, types, settings, buttons, swipe, hints, thai] = await Promise.all([
        // Every card, not only this deck's: a gate on a deck above this one counts its whole subtree.
        repo.listCards(), repo.listNotes(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
        repo.listDeckParams(), repo.listNoteTypes(), repo.listDeckSettings(), repo.answerButtons(), repo.swipeToRate(), repo.showCardHints(), repo.thaiTextSize(),
      ]);
      if (stale) return;
      if (writes.current !== seen) { setReloads((k) => k + 1); return; }
      const today = studiedToday({ notes: n, cards: c, reviews, revlog, now, dayStartsAtHour: cs.dayStartsAtHour });
      loadedDay.current = studyDayKey(now, cs.dayStartsAtHour);
      setCollection(cs);
      // The queue reads the day from `now`: a reload after a while away (or past the day's start) needs it fresh too.
      setNow(now);
      setAnswerButtons(buttons);
      setSwipeOn(swipe);
      setShowHints(hints);
      setThaiSize(thai);
      setDeckSettings(settings);
      setAllParams(params);
      setNoteTypes(types);
      setStudied(today);
      setNotes(new Map(n.map((x) => [x.id, x])));
      const deckOfNote = new Map(n.map((x) => [x.id, x.deck]));
      const dayNumber = ankiToday(now, cs.dayStartsAtHour, cs.collectionCreated, cs.creationOffset);
      loadSnapshot.current = buildLoadSnapshot(
        c, (card) => paramsForDeck(cardHomeDeck(card, deckOfNote.get(card.noteId) ?? ''), params)?.presetId,
        (card) => loadDayIndex(card, now, cs.dayStartsAtHour, dayNumber),
      );
      setCards(c);
    })().catch((e) => { if (!stale) setLoadError(failureText(e, { what: "Couldn't load this deck.", next: 'Try again.' })); });
    // A newer load (focus and the note editor closing both start one) supersedes this one.
    return () => { stale = true; };
  }, [repo, deck, reloads, reloadKey]);

  // Forms practice and lookalikes (src/ui/ReviewForms.tsx): held lookalikes, the offer to show a card sooner, suggestions.
  const forms = useReviewForms(repo, { cards, notes, deckSettings, now, dayStartsAtHour: H });
  // The reasons chosen on Again, and the "Last time" reminder they bring back (src/core/misses.ts).
  const misses = useMissMarks(repo);
  // Words linked as ones that get mixed up (src/core/confusedPairs.ts), and the sheet that links one.
  const confused = useConfusedPairs(repo);
  const vacation = useVacationPrefs();
  const deckOf = useMemo(() => new Map([...notes.values()].map((n) => [n.id, n.deck])), [notes]);
  const queue = useMemo(() => {
    if (!cards) return null;
    return treeQueue(deck, queueInput({
      notes: notes.values(), cards, params: allParams, studied, gateFor: (d) => deckSettings.get(d)?.gateCap, collection, now, held: forms.held, vacation, boostFor: boostFor({ notes: notes.values(), settings: deckSettings, now }),
    }));
  }, [cards, notes, allParams, studied, deckSettings, collection, deck, now, forms.held, vacation]);

  const current = queue ? currentCard(queue, preferId) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  const glossFor = useCardGlosses(glossing, queue?.order, notes);
  useEffect(() => { forms.showing({ card: current, note, revealed }); }, [current, note, revealed, forms.showing]); // eslint-disable-line react-hooks/exhaustive-deps
  // The card's own deck decides its FSRS settings, not the deck being studied.
  const cardParams = note && current ? paramsForDeck(cardHomeDeck(current, note.deck), allParams) : undefined;
  // A shaky review card says so on its answer (display only: nothing here reads into the rating or the queue).
  const fragile = revealed && current ? fragilePercent(current, new Date(), cardParams?.weights ?? []) : undefined;
  const noteType = note && current?.kind.startsWith('t') && !isOmnilanguage(note) ? noteTypes.get(note.model) : undefined;
  // What's typed into a {{type:}} card's box, compared on the back once the answer is shown.
  const [typed, setTyped] = useState('');
  // The box sits in the footer, so the screen is padded by the keyboard's height while it's up. The
  // keyboard covers the home indicator area the footer already leaves, so that much isn't added twice.
  const insets = useSafeAreaInsets();
  const header = useHeaderInset();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const typedShown = revealed ? typed : '';
  // The card's preset says whether a template card's sounds and {{tts:}} play on their own (Anki's autoplay).
  const autoplay = cardParams?.autoplay ?? true;
  const page = useMemo(() => {
    if (!note || !noteType || !current) return undefined;
    const ord = Number(current.kind.slice(1));
    const { front, back, typeAnswer } = renderTemplateCard(note, noteType, ord, typedShown);
    const opts = {
      css: noteType.css, ord, dark, autoplay, mediaBase: mediaBaseUri(), mathjax: mathjaxUri(),
      colors: { background: c.surface, text: c.text, cloze: c.countNew },
    };
    return { front: cardDocument(front, opts), back: cardDocument(back, opts), typeAnswer, frontAudio: sideAudio(front), backAudio: sideAudio(back) };
  }, [note, noteType, current?.id, current?.kind, dark, c, typedShown, autoplay]); // eslint-disable-line react-hooks/exhaustive-deps
  // Which word a reverse card wants when other notes share its meaning (synonyms.ts), from every note loaded.
  const wanted = useMemo(() => wantedLines(notes.values()), [notes]);
  const rendered = current && note && !page ? renderCard(note, current.kind, wanted.get(note.id)) : undefined;
  // The fuzz seed and load balancer for answering the current card, as Anki has them: the buttons show what an answer does.
  const baseContext = (card: Card, when: Date): AnswerContext => {
    const seed = fuzzSeed(card.ankiId, card.sched.reps) ?? BigInt.asUintN(64, fnvHash(card.id) + BigInt(card.sched.reps));
    // A card in a filtered deck has no preset there, so Anki fuzzes it without balancing.
    const balance = collection.loadBalancer === false || card.filteredDeck ? undefined : balancerFor(loadSnapshot.current, card, {
      preset: cardParams?.presetId, seed, easyDays: cardParams?.easyDays, buryReviews: !!cardParams?.bury?.reviews,
      nextDayAt: nextStudyDayStart(when, H),
    });
    return { seed, dayStartsAtHour: H, balance };
  };
  // What Good would bring the current card back in, counted from `from` (a lookalike) or its last review.
  const goodFrom = (from?: Date) => (current ? previewIntervals(current.sched, now, cardParams, { ...baseContext(current, now), countFrom: from })[3] : '');
  // A lookalike may have given the answer away: counted from when it was seen, unless turned off, or unless
  // that wouldn't change Good's interval (the offer isn't shown then, so it mustn't apply unseen).
  const soonerApplies = !!forms.countFrom && goodFrom(forms.countFrom) !== goodFrom();
  const answerContext = (card: Card, when: Date): AnswerContext => ({
    ...baseContext(card, when), countFrom: card.id === current?.id && soonerApplies ? forms.countFrom : undefined,
  });
  const intervals = current && revealed ? previewIntervals(current.sched, now, cardParams, answerContext(current, now)) : undefined;

  // One player for the session's recorded audio, released when the screen closes.
  const player = useRef<AudioPlayer | null>(null);
  const phoneSpeech = usePhoneSpeech(repo);
  useEffect(() => () => { player.current?.remove(); player.current = null; Speech.stop(); }, []);

  /**
   * Plays what `playbackFor` / `autoplayFor` chose: the note's recording when it's allowed and the
   * file is here, as Anki plays it, else the phone's text-to-speech voice.
   */
  const ttsRunning = useRef(false);
  // Record yourself: a take of your own voice for this card, played back next to its recording.
  const self = useSelfRecording(current?.id ?? null, AUDIO_MODE, {
    onBeforeAudio: () => {
      if (ttsRunning.current) { Speech.stop(); ttsRunning.current = false; }
      player.current?.pause();
    },
  });
  const speak = useCallback(
    (what: Playback | undefined) => {
      if (!what || !rendered) return;
      self.stopTake();
      // Stopping speech that isn't running can pull the audio session out from under the
      // recording that starts right after, cutting it off.
      if (ttsRunning.current) { Speech.stop(); ttsRunning.current = false; }
      player.current?.pause();
      const uri = what.file ? mediaFileUri(what.file) : undefined;
      if (uri) {
        // Keep the session active between clips: reactivating it for each one sometimes stalled the next.
        player.current ??= createAudioPlayer(null, { keepAudioSessionActive: true });
        player.current.replace({ uri });
        player.current.play();
        return;
      }
      if (!what.text) return;
      ttsRunning.current = true;
      phoneSpeech.sayWord(what.text, rendered.speechLang);
    },
    [rendered, phoneSpeech, self.stopTake],
  );

  // The Example sentence's speaker button: the phone's voice for the note's language, at the speed chosen
  // for it (Settings, Voices). Never the note's recording, which is of the word and not the sentence.
  const speechLang = rendered?.speechLang;
  const speakSentence = useCallback((text: string) => {
    if (!speechLang) return;
    self.stopTake();
    player.current?.pause();
    ttsRunning.current = true;
    phoneSpeech.sayLine(text, speechLang, false);
  }, [speechLang, phoneSpeech, self.stopTake]);

  // Anki's {{tts:}} tags, read with the phone's voices: on their own when a side without a
  // recording is shown and the preset autoplays (a recording plays instead, in the page), and
  // from each play button.
  const readAloud = useCallback((tags: TtsTag[]) => {
    Speech.stop();
    phoneSpeech.readTags(tags);
  }, [phoneSpeech]);
  const pageAudio = page && (revealed ? page.backAudio : page.frontAudio);
  useEffect(() => {
    if (!pageAudio) return;
    if (pageAudio.hasSound || !pageAudio.tts.length || !autoplay) Speech.stop();
    else readAloud(pageAudio.tts);
  }, [current?.id, revealed]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPageMessage = (data: string) => {
    try {
      const i = JSON.parse(data)?.tts;
      const tag = typeof i === 'number' ? pageAudio?.tts[i] : undefined;
      if (tag) readAloud([tag]);
    } catch { /* not a message of ours */ }
  };

  // When the card came up, for the time Anki records against each answer.
  const shownAt = useRef(Date.now());
  // One warning per session if answers can't be written into the Anki collection.
  const warnedAnki = useRef(false);
  // Each showing of a card: the same card back again (after Again, with nothing else left, or an undo)
  // is a new showing, timed, spoken and faded in afresh, as the WebView's key below does for a template card.
  const showing = current ? `${current.id}:${history.length}` : undefined;
  useEffect(() => { shownAt.current = Date.now(); }, [showing]);
  // Each card, and each time a card comes back, starts with an empty box.
  useEffect(() => { if (!revealed) setTyped(''); }, [showing, revealed]);
  // Type it (activeRecall.ts): the box a reverse card's word is typed into, opened from beside Show answer.
  const [typing, setTyping] = useState(false);
  // Whether the box was last filled by speaking (Answer by speaking, src/core/speaking.ts), for "You said".
  const [spokenIn, setSpokenIn] = useState(false);
  useEffect(() => { setTyping(false); setSpokenIn(false); }, [showing]);
  // An Omnilanguage card knows its language; an Anki type-in answer on another note type is read from its script.
  const typeInExpected = page?.typeAnswer?.expected;
  const typedKeyboard = useKeyboardLanguage(rendered?.speechLang ?? (typeInExpected ? keyboardLanguageForText(stripExpected(typeInExpected)) : undefined));
  const spoken = useSpokenAnswer(rendered?.speechLang, {
    expected: rendered && note && current ? typeItAnswer(note, current) : undefined,
    onBeforeListen: () => { Keyboard.dismiss(); self.stop(false); },
    onHeard: (text) => { setTyping(true); setSpokenIn(true); setTyped(text); },
  });
  useEffect(() => { spoken.cancel(); }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownHook = useOwnHook(repo, showing, useCallback((n: Note) => setNotes((prev) => new Map(prev).set(n.id, n)), []));
  // The session end's list of misses, and what of them Similar words can practice (SessionMisses.tsx).
  const sessionMisses = useSessionMisses(history, notes, cards, !!onPracticeMixups, noteTypes, confused.pairs);

  // Auto-speak the front when a card with audio appears.
  useEffect(() => {
    if (rendered) speak(autoplayFor(rendered, false));
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (rating: RatingValue, miss?: string) => {
    if (!current || !note || busy.current || current === lastAnswered.current) return;
    busy.current = true;
    haptic.answer();
    cardMotion.current?.flash(rating);
    try {
      // Rebuilding the queue for the next card blocks JS for a while on a big deck, and the haptic's
      // native call isn't sent until that's done. One frame here lets the haptic and the flash out first.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const when = new Date();
      // A filtered deck that doesn't reschedule only previews: the card's schedule stays as it
      // was, and it goes home to its own deck (Anki would show it again after a short delay first).
      const filtered = current.filteredDeck ? paramsForDeck(current.filteredDeck, allParams)?.filtered : undefined;
      const preview = filtered?.reschedule === false;
      // Again, Hard and Good show a previewed card again after the deck's delay; Easy, or a delay of 0, finishes it.
      const delay = preview ? [0, filtered.previewSecs?.again ?? 0, filtered.previewSecs?.hard ?? 0, filtered.previewSecs?.good ?? 0, 0][rating] : 0;
      const previewAgainAt = delay > 0 ? new Date(when.getTime() + delay * 1000) : undefined;
      const res = preview ? { sched: current.sched, log: previewLog(current, rating, when) } : review(current.sched, rating, when, cardParams, answerContext(current, when));
      // A forgotten review can make the card a leech: its note is tagged, and the card suspended if the preset says so, as in Anki.
      const leech = cardParams?.leech ?? DEFAULT_LEECH;
      const isLeech = !preview && becameLeech(current.sched, res.sched, leech);
      const updated: Card = {
        ...current, sched: res.sched, buriedAt: undefined, suspended: current.suspended || (isLeech && leech.suspend),
        // Out of a filtered deck once it's a review (or a finished preview), as in Anki; still learning, it stays.
        filteredDeck: previewAgainAt ? current.filteredDeck : preview || res.sched.state === 2 ? undefined : current.filteredDeck,
        previewDue: previewAgainAt?.toISOString(),
        // Write-back stamps the Anki card's mod, which seeds Anki's review order.
        ankiMod: current.ankiId ? Math.floor(when.getTime() / 1000) : current.ankiMod,
      };
      // The note's other cards that its preset holds back until tomorrow, as Anki does.
      const siblings = preview ? [] : siblingsToBury(current, cards ?? [], cardParams?.bury, when, H);
      const buried = siblings.map((s): Card => ({ ...s, buriedAt: when.toISOString(), ankiMod: s.ankiId ? Math.floor(when.getTime() / 1000) : s.ankiMod }));
      // Counted in the deck the card is studied in, as Anki counts it (a filtered deck's answers count there).
      // Time capped at the preset's maximum answer time, as Anki caps it, so a phone put down mid-card doesn't swell the summary.
      // `reviewId` and `anki` are filled in by the write below; undo waits for it (`reviewWrites.idle()`).
      const takenMs = answerTimeMs(when.getTime() - shownAt.current, cardParams);
      const record: AnswerRecord = {
        before: current, deck: cardDeck(current, note.deck), buried: siblings,
        rating, takenMs, preview, ...(rating === 1 && miss ? { miss } : {}),
      };
      const stepCounts = { learn: (cardParams?.learnSteps ?? DEFAULT_LEARN_STEPS).length, relearn: (cardParams?.relearnSteps ?? DEFAULT_RELEARN_STEPS).length };
      const desiredRetention = cardParams?.desiredRetention;
      const wasInFilteredDeck = current.filteredDeck;
      const interday = !preview && isInterdayLearning(current, H);
      const noteBefore = note;

      // The next card shows now. The answer is written behind it, in order (below), so the screen
      // doesn't wait on the database. If a write fails, the answer is taken off the screen again.
      // Now a review, it weighs on the days the load balancer spreads later answers over, as in Anki.
      if (updated.sched.state === 2) recordAnswer(loadSnapshot.current, updated, cardParams?.presetId, updated.sched.scheduledDays);
      // A preview uses no limits, as in Anki, and a reload (`studiedToday`) doesn't count it either.
      setStudied((s) => bumpStudied(s, record.deck, record.preview ? null : studiedKind(record.before, H), 1));
      setHistory((h) => [...h, record]);
      misses.answered(current.id, rating === 1 ? miss : undefined);
      if (rating === 1 && miss === CONFUSED_REASON && canLinkConfused(note)) confused.openLink(note.id);
      // Reads the hook typed for this card, so it's called before the next card clears it.
      void ownHook.answered(note);
      forms.answered({ cardId: current.id, ...res.log });
      // Functional update: `cards` from this render's closure is stale once the awaits return.
      const changed = new Map([updated, ...buried].map((c) => [c.id, c]));
      setCards((prev) => prev && prev.map((c) => changed.get(c.id) ?? c));
      lastAnswered.current = current;
      // Hard, Good and Easy can be changed to Again from the next card for a few seconds.
      const word = htmlToText(note.fields.Entry ?? '');
      ratingOffer.show(rating > 1 && !preview ? { cardId: current.id, rating, interval: intervals?.[rating], ...(word ? { word } : {}) } : null);
      setPreferId(undefined);
      setRevealed(false);
      setNow(when);

      writes.current++;
      void reviewWrites.add(async () => {
        // A sync or an import that holds the kept collection while this is written reads it back over
        // the cards saved here: noted so they're saved again once the collection has the answer.
        const lockAtStart = repo.ankiLockState();
        try {
          await repo.saveCard(updated);
          for (const b of buried) await repo.saveCard(b);
          // Whether it was a day-long step goes in the row, so today's counts read it back after a reload.
          // So does the filtered deck it was answered in, which a rescheduling one sends the card out of
          // once it's a review: today's counts keep it there, as Anki counts it.
          record.reviewId = await repo.addReview({
            cardId: record.before.id, ...res.log, interday,
            ...(rating === 1 && miss ? { miss } : {}),
            ...(wasInFilteredDeck ? { deck: wasInFilteredDeck } : {}),
          });
          // Into the kept Anki collection too, so "Send to Anki" carries this answer. If that write
          // fails, the answer still counts here, and you're told rather than it going missing.
          try {
            record.anki = await repo.writeAnkiAnswer({
              before: record.before, after: updated, rating, now: when,
              takenMs, desiredRetention, bury: siblings,
              preview: preview ? { again: previewAgainAt } : undefined,
              steps: stepCounts,
            });
            // The write waits on `lockAnki`. A sync that held it meanwhile read the kept collection,
            // which didn't have this answer yet, back over the rows saved above. Saved again now that
            // the collection has it, so both agree. Skipped when nothing else took the lock (the
            // usual case): this answer's own write is the one run counted after `lockAtStart`.
            const lockNow = repo.ankiLockState();
            if (lockAtStart.held || lockNow.runs > lockAtStart.runs + 1) {
              await repo.saveCard(updated);
              for (const b of buried) await repo.saveCard(b);
            }
          } catch (e: any) {
            if (!warnedAnki.current) {
              warnedAnki.current = true;
              Alert.alert(
                "Couldn't save this answer for Anki",
                failureText(e, { next: "It counts in Franki, but it won't be in the file sent to Anki." }),
              );
            }
          }
          if (isLeech && !noteBefore.tags.includes('leech')) {
            try {
              const tagged = await saveNote(repo as NoteStore, { id: noteBefore.id, deck: noteBefore.deck, model: noteBefore.model, fields: noteBefore.fields, tags: [...noteBefore.tags, 'leech'] }, when);
              record.leechNoteId = noteBefore.id;
              setNotes((prev) => new Map(prev).set(tagged.id, tagged));
            } catch {
              // The answer stands; the tag just isn't added.
            }
          }
          if (isLeech && canAddMnemonic(noteBefore)) {
            setLeechPrompt({ noteId: noteBefore.id, misses: res.sched.lapses, ...(updated.suspended && !record.before.suspended ? { suspendedCardId: record.before.id } : {}) });
          }
        } catch (e) {
          // Taken off the screen, and the deck is read again so what's shown is what was saved.
          setHistory((h) => h.filter((r) => r !== record));
          ratingOffer.show(null);
          setReloads((n) => n + 1);
          Alert.alert("Couldn't save this answer", failureText(e, { next: 'The card will come back: answer it again.' }));
        } finally {
          writes.current++;
        }
      });
    } finally {
      busy.current = false;
    }
  };

  /** An answer from a button: the card leaves toward its rating, then the answer is written. */
  const rate = async (r: RatingValue, miss?: string) => {
    if (rating.current || busy.current || !current || current === lastAnswered.current) return;
    rating.current = true;
    try {
      await answer(r, miss);
    } finally {
      rating.current = false;
    }
  };

  const undo = async (): Promise<boolean> => {
    const last = history[history.length - 1];
    if (!last || busy.current) return false;
    busy.current = true;
    writes.current++;
    haptic.tap();
    try {
      // The answer's own writes finish first: they give the review row and the Anki write to take back.
      await reviewWrites.idle();
      if (last.reviewId === undefined) return false; // its write failed, and said so
      // Out of the Anki collection first: a synced answer is in the server's history, and taking
      // it back here alone would leave the two disagreeing. As in Anki, undo stops at the last sync.
      if (last.anki && !(await repo.undoAnkiAnswer(last.anki))) {
        setHistory([]);
        ratingOffer.show(null);
        Alert.alert("Couldn't undo that answer", 'It has already been synced to your Anki server. Undo only goes back to the last sync.');
        return false;
      }
      await repo.saveCard(last.before);
      for (const s of last.buried) await repo.saveCard(s);
      // The note as it is now, not as it was before the answer: a hint typed in the leech sheet
      // since then stays, and only the tag comes off.
      const n = last.leechNoteId ? await repo.getNote(last.leechNoteId) : undefined;
      if (n) {
        try {
          const restored = await saveNote(repo as NoteStore, { id: n.id, deck: n.deck, model: n.model, fields: n.fields, tags: n.tags.filter((t) => t !== 'leech') });
          setNotes((prev) => new Map(prev).set(restored.id, restored));
        } catch { /* the tag stays */ }
      }
      await repo.deleteReview(last.reviewId);
      misses.undone(last.before.id);
      // The undone card comes back in from the side it left.
      cardMotion.current?.enterFrom(last.rating === 1 ? -1 : 1);
      forgetCard(loadSnapshot.current, last.before.id);
      setHistory((h) => h.slice(0, -1));
      forms.undone(last.before.id);
      setStudied((s) => bumpStudied(s, last.deck, last.preview ? null : studiedKind(last.before, H), -1));
      const restored = new Map([last.before, ...last.buried].map((c) => [c.id, c]));
      setCards((prev) => prev && prev.map((c) => restored.get(c.id) ?? c));
      // The card shown again is the very one answered: it can be answered again now.
      lastAnswered.current = null;
      setPreferId(last.before.id);
      setRevealed(false);
      setNow(new Date());
      ratingOffer.show(null);
      return true;
    } catch (e) {
      Alert.alert("Couldn't undo that answer", failureText(e, { next: 'Try again.' }));
      return false;
    } finally {
      busy.current = false;
      writes.current++;
    }
  };

  // Change to Again: take the last answer back, then answer the same card Again once it's the current one again.
  const changeToAgain = async () => {
    const o = ratingOffer.offer;
    const last = history[history.length - 1];
    if (!o || !last || last.before.id !== o.cardId) { ratingOffer.show(null); return; }
    if (await undo()) setAgainFor(o.cardId);
  };
  useEffect(() => {
    if (!againFor || !current || current.id !== againFor || !note) return;
    setAgainFor(null);
    (async () => {
      await answer(1);
      // `lastAnswered` is set only once the answer is saved, so a failed one (which alerts) isn't confirmed.
      if (lastAnswered.current?.id === againFor) ratingOffer.show({ cardId: againFor, rating: 1, changed: true });
    })();
  }, [againFor, current, note]); // eslint-disable-line react-hooks/exhaustive-deps

  // A session that runs past the day's start counts the new day's answers from nothing, with the
  // load balancer's days read afresh: the cards are loaded again once the clock crosses it.
  useEffect(() => {
    if (loadedDay.current && studyDayKey(now, H) !== loadedDay.current) setReloads((n) => n + 1);
  }, [now, H]);

  // Out of cards with a learning card still to come: wake when it's within the learn-ahead limit
  // instead of declaring the deck done, which left it waiting until the deck was reopened.
  const waitingFor = !current && cards
    ? nextLearningDue(cards.filter((c) => isInDeck(cardDeck(c, deckOf.get(c.noteId) ?? ''), deck)), { dayStartsAtHour: H })
    : undefined;
  useEffect(() => {
    if (!waitingFor) return;
    const wake = waitingFor.getTime() - collection.learnAheadMinutes * 60000 - Date.now();
    const id = setTimeout(() => setNow(new Date()), Math.max(0, wake) + 1000);
    return () => clearTimeout(id);
  }, [waitingFor?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clearing the deck by answering its last card is worth a tap; opening one with nothing due isn't.
  const cleared = !!cards && !current && !waitingFor && history.length > 0;
  useEffect(() => { if (cleared) haptic.success(); }, [cleared]);

  const title = deck.split('::').pop() ?? deck;
  const leechNoteNow = leechPrompt ? notes.get(leechPrompt.noteId) : undefined;
  const question = leechNoteNow ? mnemonicQuestion(leechNoteNow) : undefined;
  const leechSheet = leechPrompt && leechNoteNow ? (
    <LeechHintSheet
      word={htmlToText(leechNoteNow.fields.Entry ?? '')}
      translit={htmlToText(leechNoteNow.fields.Transliteration ?? '') || undefined}
      gloss={htmlToText(leechNoteNow.fields.Meaning ?? '') || undefined}
      misses={leechPrompt.misses}
      suspended={!!leechPrompt.suspendedCardId}
      suggest={suggestHints && question ? () => suggestHints(question) : undefined}
      onSkip={() => setLeechPrompt(null)}
      onSave={async (hint) => {
        // The card as it is now, captured before the awaits: still suspended, or nothing to bring back.
        const suspended = cards?.find((c) => c.id === leechPrompt.suspendedCardId && c.suspended);
        const when = new Date();
        writes.current++;
        let result: Awaited<ReturnType<typeof saveLeechHint>>;
        try {
          result = await saveLeechHint(repo as NoteStore & AnkiLink, leechNoteNow, hint, suspended, when, H);
        } finally {
          writes.current++;
        }
        const { note: saved, card, cardError, ankiError } = result;
        setNotes((prev) => new Map(prev).set(saved.id, saved));
        if (card) {
          setCards((prev) => prev && prev.map((c) => (c.id === card.id ? card : c)));
          setNow(when);
        }
        setLeechPrompt(null);
        if (cardError) {
          Alert.alert("Couldn't unsuspend this card", failureText(cardError, { next: 'Your hint is saved. To study the card again, unsuspend it when you edit its note.' }));
        } else if (ankiError) {
          Alert.alert("Couldn't save this change for Anki", failureText(ankiError, { next: "It's made in Franki, but it won't reach Anki." }));
        }
      }}
    />
  ) : null;
  // Not while the leech sheet is up: two sheets can't be presented at once.
  const linkingNote = confused.linking && !leechPrompt ? notes.get(confused.linking) : undefined;
  const confusedSheet = linkingNote && cards ? (
    <ConfusedLinkSheet
      note={linkingNote}
      notes={notes}
      cards={cards}
      pairs={confused.pairs}
      onLink={(partnerId) => confused.link(linkingNote.id, partnerId)}
      onUnlink={(partnerId) => confused.unlink(linkingNote.id, partnerId)}
      onClose={() => confused.openLink(null)}
    />
  ) : null;
  if (!cards) return <Screen title={title} largeTitle={false}><Loading error={loadError} onRetry={() => setReloads((n) => n + 1)} /></Screen>;

  const undoButton = history.length
    ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel="Undo the last answer" onPress={undo} />
    : null;

  if (!current || !note || (!rendered && !page)) {
    const minutes = waitingFor ? Math.max(1, Math.ceil((waitingFor.getTime() - Date.now()) / 60000) - collection.learnAheadMinutes) : 0;
    const studiedWords = practice ? practiceWords(history.map((h) => ({ noteId: h.before.noteId, deck: h.deck })), notes, practice.languageDeck) : [];
    const reading = !!(studiedWords.length && practice);
    // Use today's words (reader/production.ts): the language's notes answered while new, to write a sentence with.
    const newWords = practice?.onUseWords ? wordsToUse(
      history.map((h) => ({ noteId: h.before.noteId, wasNew: h.before.sched.state === 0 })),
      (id) => {
        const n = notes.get(id);
        return n && isOmnilanguage(n) && isInDeck(n.deck, practice.languageDeck)
          ? { word: headword(n), meaning: htmlToText(n.fields.Meaning ?? '').replace(/\s+/g, ' ').trim() }
          : undefined;
      },
    ) : [];
    const checking = forms.toCheck.length;
    const mixing = sessionMisses.practice.length;
    // What can be done with the session just finished: rows in the list, so the footer stays two buttons.
    const steps: NextStep[] = [
      ...sessionMisses.practice.map((p) => ({
        key: `${p.request.mode}|${p.request.language}`, label: p.label, icon: { name: 'shuffle' as const, color: c.violet }, onPress: () => onPracticeMixups?.(p.request),
      })),
      ...(checking ? [{
        key: 'forms', label: checking === 1 ? 'Practice its forms' : `Practice these ${checking}`, icon: { name: 'list.bullet' as const, color: c.teal },
        onPress: () => onPracticeForms(forms.drillFor(forms.toCheck.map((x) => x.note.id), deck)),
      }] : []),
      ...(reading ? [{
        key: 'read', label: 'Read a text with these words', icon: { name: 'book' as const, color: c.easy }, busy: openingText,
        onPress: () => {
          if (openingRef.current) return;
          openingRef.current = true;
          setOpeningText(true);
          practice!.onRead(studiedWords).catch(() => undefined).finally(() => { openingRef.current = false; setOpeningText(false); });
        },
      }] : []),
      ...(newWords.length ? [{
        key: 'write', label: newWords.length === 1 ? 'Write a sentence with the new word' : `Write sentences with the ${newWords.length} new words`,
        icon: { name: 'square.and.pencil' as const, color: c.orange }, onPress: () => practice?.onUseWords?.(newWords),
      }] : []),
      // An Anki filtered deck has no limits or cards of its own to add to.
      ...(paramsForDeck(deck, allParams)?.filtered ? [] : [{ key: 'custom', label: 'Custom study', icon: { name: 'slider.horizontal.3' as const, color: c.indigo }, onPress: onCustomStudy }]),
    ];
    // The next deck, or back to the top, is the one thing to do next; Back to decks is always there.
    const footer = (
      <>
        {/* Rise in one after another once the summary has settled. */}
        {onNextDeck ? <Reveal rise={12} delay={820}><Button label={`Next up: study ${nextDeck}`} onPress={onNextDeck} /></Reveal> : null}
        {onEarlierDeck ? <Reveal rise={12} delay={onNextDeck ? 910 : 820}><Button label={`Back to the top: ${earlierDeck}`} variant={onNextDeck ? 'secondary' : 'primary'} onPress={onEarlierDeck} /></Reveal> : null}
        <Reveal rise={12} delay={820 + (onNextDeck ? 90 : 0) + (onEarlierDeck ? 90 : 0)}><Button label="Back to decks" variant={onNextDeck || onEarlierDeck ? 'secondary' : 'primary'} onPress={onDone} /></Reveal>
      </>
    );
    return (
      <>
      {leechSheet}
      {confusedSheet}
      <Screen
        title={title}
        largeTitle={false}
        toolbar={undoButton ? <Stack.Toolbar placement="right">{undoButton}</Stack.Toolbar> : undefined}
        footer={footer}
      >
        <View style={{ flex: 1 }}>
          {/* Scrolls when the summary, the forms check and the next steps outgrow the space above the buttons.
              Starts at the top rather than centering: the centering box counts the header's inset, so a long
              summary got a gap above the checkmark that pushed its last rows under the buttons. */}
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ ...readable, flexGrow: 1, alignItems: 'center', gap: space.s, padding: space.xl }}>
          {/* The end of a session arrives in order: the mark, the words, the figures, then what to do next. */}
          <Pop from={0} bounciness={10}>
            <Icon name={waitingFor ? 'clock' : 'checkmark.circle.fill'} size={56} color={waitingFor ? c.textTertiary : c.countDue} weight="regular" />
          </Pop>
          <Reveal rise={8} delay={380}>
            <Text style={{ ...type.title, color: c.text, textAlign: 'center', marginTop: space.s }}>
              {waitingFor ? 'Nothing due right now' : 'All done for now'}
            </Text>
          </Reveal>
          <Reveal rise={8} delay={460}>
            <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
              {waitingFor ? `The next card comes back in about ${minutes} min.` : 'Nothing else is due in this deck today.'}
            </Text>
          </Reveal>
          {history.length ? <Reveal rise={8} delay={560} style={{ alignSelf: 'stretch' }}><SessionSummary history={history} delay={560} /></Reveal> : null}
          {sessionMisses.rows.length || forms.toCheck.length || steps.length || extraCard ? (
            <Reveal rise={8} delay={760} style={{ alignSelf: 'stretch', gap: space.s }}>
              <SessionMissList rows={sessionMisses.rows} />
              <FormsCheck items={forms.toCheck} />
              {extraCard}
              <NextSteps steps={steps} />
            </Reveal>
          ) : null}
          </ScrollView>
        </View>
      </Screen>
      </>
    );
  }

  const reveal = () => {
    Keyboard.dismiss();
    // A take made from memory ends here, quietly, so the answer's own recording plays.
    self.stop(false);
    setRevealed(true);
    if (rendered) speak(autoplayFor(rendered, true));
  };
  // Type it and the learner's own hook (activeRecall.ts), for a native Omnilanguage card.
  const typeItWord = rendered ? typeItAnswer(note, current) : undefined;
  const asksHook = !!rendered && ownHook.on && asksOwnHook(note, current, noteCards(current, cards));
  // Under the answer: what was typed against the word, the offer to show the card sooner, the suggestion to practice its forms, and the hook.
  const extras = revealed ? (
    <>
      {typing && typeItWord ? <TypedDiff comparison={compareTyped(typeItWord, typed)} showExpected={false} lang={rendered?.speechLang} typedLabel={spokenIn ? 'You said' : 'Yours'} /> : null}
      {typing && typeItWord && spokenIn ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{spokenAnswerNote(rendered?.speechLang)}</Text> : null}
      <AnswerExtras
        word={headword(note)}
        offer={forms.offerView(goodFrom)}
        onSooner={forms.setSooner}
        suggestion={forms.suggestion}
        onPractice={() => onPracticeForms(forms.drillFor([note.id], note.deck))}
        onLater={() => forms.putOff(note.id)}
      />
      <ConfusedRow note={note} partners={confused.partners} notes={notes} onPress={() => confused.openLink(note.id)} />
      {asksHook ? <OwnHookField value={ownHook.text} onChange={ownHook.setText} /> : null}
    </>
  ) : null;
  const shown = ratingsShown(answerButtons);
  // Again's menu of what can go wrong, for the languages that have one; other cards get a plain Again.
  const missReasons = note ? missReasonsFor(note) : [];
  const reminder = current && missReasons.length ? missReminder(misses.log.get(current.id) ?? [], missReasons) : null;
  const buttons = ([
    { r: 1, label: 'Again', color: c.again },
    { r: 2, label: 'Hard', color: c.hard, on: c.onHard },
    { r: 3, label: 'Good', color: c.good },
    { r: 4, label: 'Easy', color: c.easy },
  ] as { r: RatingValue; label: string; color: string; on?: string }[]).filter((b) => shown.includes(b.r));

  const footer = revealed ? (
    <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
      {buttons.map((b) => b.r === 1 && missReasons.length ? (
        <AgainSplit key={b.r} interval={intervals?.[1]} reasons={missReasons} onAnswer={(miss) => rate(1, miss)} />
      ) : (
        <Tappable
          key={b.r}
          onPress={() => rate(b.r)}
          accessibilityRole="button"
          accessibilityLabel={`${b.label}, next in ${intervals?.[b.r] ?? ''}`}
          scaleTo={0.95}
          dimTo={0.85}
          style={{
            flex: 1, minHeight: 60, borderRadius: radius.m + 2, ...smooth, paddingVertical: space.s,
            alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: b.color,
          }}
        >
          {/* The interval sits above the label, as in Anki, so the eye lands on when it's next due. */}
          <Text style={{ ...type.footnote, color: b.on ?? c.onRating, fontVariant: ['tabular-nums'] }}>{intervals?.[b.r]}</Text>
          <Text style={{ ...type.headline, color: b.on ?? c.onRating }}>{b.label}</Text>
        </Tappable>
      ))}
    </Reveal>
  ) : (
    <>
      {page?.typeAnswer || (typing && typeItWord) ? (
        <TextInput
          key={current.id}
          {...typedKeyboard}
          value={typed}
          onChangeText={(t) => { setTyped(t); setSpokenIn(false); }}
          onSubmitEditing={reveal}
          autoFocus={!spokenIn}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          placeholder={page?.typeAnswer ? 'Type the answer' : 'Type the word'}
          accessibilityLabel={page?.typeAnswer ? 'Type the answer' : 'Type the word'}
          placeholderTextColor={c.textTertiary}
          selectionColor={c.accent}
          keyboardAppearance={dark ? 'dark' : 'light'}
          style={{
            ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
            borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
          }}
        />
      ) : null}
      {typeItWord ? <ListeningNote spoken={spoken} language={rendered?.speechLang ? languageName(rendered.speechLang.split('-')[0]) : 'the word'} /> : null}
      {typeItWord && !typing ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <TypeItButton onPress={() => setTyping(true)} />
          <SpeakButton spoken={spoken} />
          <Button label="Show answer" onPress={reveal} style={{ flex: 1 }} />
        </View>
      ) : typeItWord ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <SpeakButton spoken={spoken} />
          <Button label="Check" onPress={() => { spoken.cancel(); reveal(); }} style={{ flex: 1 }} />
        </View>
      ) : (
        <Button label={typing ? 'Check' : 'Show answer'} onPress={reveal} />
      )}
    </>
  );

  // Suspend, bury or flag cards from the menu: in Franki first, then in the kept collection, as Anki writes it.
  const setStates = async (targets: Card[], change: (s: CardState) => CardState) => {
    if (busy.current || !targets.length) return;
    busy.current = true;
    writes.current++;
    try {
      const when = new Date();
      const { cards: updated, ankiError } = await setCardStates(repo, targets, change, when, H);
      if (ankiError) {
        Alert.alert("Couldn't save this change for Anki", failureText(ankiError, { next: "It's made in Franki, but it won't reach Anki." }));
      }
      const byId = new Map(updated.map((u) => [u.id, u]));
      setCards((prev) => prev && prev.map((c) => byId.get(c.id) ?? c));
      setRevealed(false);
      setNow(when);
      haptic.success();
    } catch (e) {
      Alert.alert("Couldn't change this card", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
      writes.current++;
    }
  };
  const chooseFlag = () => {
    const names = FLAG_NAMES.slice(1);
    const options = [...names, ...(current.flag ? ['Remove flag'] : []), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Flag this card', options, cancelButtonIndex: options.length - 1 }, (i) => {
      if (i === options.length - 1) return;
      const flag = i < names.length ? i + 1 : 0;
      setStates([current], (s) => ({ ...s, flag }));
    });
  };
  // Flag for an agent (through the Franki MCP): the purple flag on the card, a flag::<reason> tag on the note.
  const chooseAgentFlag = () => {
    const target = current;
    const targetNote = note;
    chooseAgentFlagReason(target.flag === AGENT_FLAG, async (reason) => {
      if (!reason) {
        setStates([target], (s) => ({ ...s, flag: 0 }));
        return;
      }
      if (targetNote && !busy.current) {
        try {
          const tagged = await saveNote(repo as NoteStore, { id: targetNote.id, deck: targetNote.deck, model: targetNote.model, fields: targetNote.fields, tags: withFlagReason(targetNote.tags, reason) });
          setNotes((prev) => new Map(prev).set(tagged.id, tagged));
        } catch (e) {
          Alert.alert("Couldn't flag this card", failureText(e, { next: 'Nothing was changed. Try again.' }));
          return;
        }
      }
      setStates([target], (s) => ({ ...s, flag: AGENT_FLAG }));
    });
  };
  // Forget and Set Due Date: in the kept collection as Anki does them, then in Franki (rescheduleService.ts).
  const reschedule = async (run: (when: Date) => Promise<Card[]>, failure: string) => {
    if (busy.current) return;
    busy.current = true;
    writes.current++;
    try {
      const when = new Date();
      const updated = await run(when);
      const byId = new Map(updated.map((u) => [u.id, u]));
      setCards((prev) => prev && prev.map((c) => byId.get(c.id) ?? c));
      setRevealed(false);
      setNow(when);
      haptic.success();
    } catch (e) {
      Alert.alert(failure, failureText(e, { next: 'Nothing was changed. Try again.' }));
    } finally {
      busy.current = false;
      writes.current++;
    }
  };
  const chooseForget = () => {
    const options = ['Forget', 'Forget and reset counts', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({
      title: 'Forget this card?',
      message: "It becomes a new card again, back in its place among the new cards, and its memory is cleared. Reset counts also sets its review and lapse counts to zero.",
      options, cancelButtonIndex: 2, destructiveButtonIndex: 0,
    }, (i) => {
      if (i === 2) return;
      const target = current;
      reschedule((when) => forgetCards(repo as NoteStore, [target], { resetCounts: i === 1 }, when), "Couldn't forget this card");
    });
  };
  const chooseDueDate = () => {
    const target = current;
    Alert.prompt(
      'Set due date',
      'Days from today: 0 for today, 1 for tomorrow. A range like 3-7 picks a day in it at random.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set',
          onPress: (text?: string) => {
            const spec = parseDueDate(text ?? '');
            if (!spec) {
              Alert.alert("That isn't a number of days", 'Enter a whole number of days, like 3, or a range like 3-7.');
              return;
            }
            reschedule((when) => setDueDates(repo as NoteStore, [target], spec, when), "Couldn't set the due date");
          },
        },
      ],
      'plain-text', '', 'numbers-and-punctuation',
    );
  };
  return (
    <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
    {leechSheet}
    {confusedSheet}
    {askCard ? (
      <AskCardSheet
        card={askCard}
        ask={askAboutCard ? (turns) => askAboutCard(askCard, turns) : undefined}
        // Added to the note's Notes field, as an edit made in the note editor would be.
        onSaveAnswer={isOmnilanguage(note) ? async (answer) => {
          writes.current++;
          try {
            const saved = await saveNote(repo as NoteStore, { id: note.id, deck: note.deck, model: note.model, fields: withNotesAnswer(note.fields, answer), tags: note.tags });
            setNotes((prev) => new Map(prev).set(saved.id, saved));
          } finally {
            writes.current++;
          }
        } : undefined}
        onClose={() => setAskCard(null)}
      />
    ) : null}
    <Screen
      title={title}
      largeTitle={false}
      // The stack's swipe-back would take a rightward drag before the card's own swipe sees it.
      lockGesture={swipeOn && revealed && !page && !!rendered}
      toolbar={
        <Stack.Toolbar placement="right">
          {current.flag ? (
            <Stack.Toolbar.Button icon="flag.fill" tintColor={c.flags[current.flag]} accessibilityLabel={`Flagged ${FLAG_NAMES[current.flag]}. Change the flag`} onPress={chooseFlag} />
          ) : null}
          {undoButton}
          <Stack.Toolbar.Button
            icon="pencil"
            accessibilityLabel="Edit this card's note"
            onPress={() => onEditNote({ noteId: note.id }, (result) => {
              if (!result) return;
              // A deleted note's cards are gone, so an answer to one can't be undone any more.
              if ('deleted' in result) setHistory([]);
              else setPreferId(current.id);
              setReloads((n) => n + 1);
            })}
          />
          <ReviewMenu
            flag={current.flag ?? 0}
            onMnemonic={canAddMnemonic(note) ? () => setLeechPrompt({ noteId: note.id }) : undefined}
            onLinkConfused={canLinkConfused(note) ? () => confused.openLink(note.id) : undefined}
            onAskClaude={() => {
              const card = cardForClaude(note, noteTypes.get(note.model), current.kind);
              if (card) setAskCard(card);
              else Alert.alert("Can't ask about this card", 'This card has no text to ask about. Open its note to see the fields.');
            }}
            onFlag={(flag) => setStates([current], (s) => ({ ...s, flag }))}
            onAgentFlag={chooseAgentFlag}
            onBuryCard={() => setStates([current], (s) => ({ ...s, buried: true }))}
            onBuryNote={() => setStates(noteCards(current, cards ?? []), (s) => ({ ...s, buried: true }))}
            onSuspend={() => setStates([current], (s) => ({ ...s, suspended: true }))}
            onDueDate={chooseDueDate}
            onForget={chooseForget}
            // The deck is loaded again when Card Info closes: the same card stays on screen.
            onCardInfo={() => { setPreferId(current.id); onCardInfo(current.id); }}
          />
        </Stack.Toolbar>
      }
      footer={footer}
      floating={ratingOffer.offer && !revealed ? <ChangeRatingStrip offer={ratingOffer.offer} onChange={changeToAgain} onUndo={undo} /> : null}
    >
      {queue ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          <Count value={dueCounts(queue).reviews} label="due" color={c.countDue} />
          <Count value={dueCounts(queue).learning} label="again" color={c.countLearn} />
          <Count value={queue.fresh.length} label="new" color={c.countNew} />
        </View>
      ) : null}
      {queue ? <ProgressBar value={sessionProgress(history.length, queue.due.length + queue.fresh.length)} style={{ marginHorizontal: space.l, marginTop: space.xs }} /> : null}
      {page ? <CardStateChips chip={stateChip(current, { learn: cardParams?.learnSteps ?? DEFAULT_LEARN_STEPS, relearn: cardParams?.relearnSteps ?? DEFAULT_RELEARN_STEPS })} leech={isLeechNote(note)} /> : null}
      {page ? (
        <SwipeCard enabled={false} cardKey={`${current.id}:${history.length}`} shown={shown} motion={cardMotion} onRate={answer}>
          {/* One WebView for both sides, so Show answer loads the back into it with the front still showing, rather than
              blanking the card while a new one starts. Keyed to the card and the answers given, so a card shown
              again (after Again, or an undo) starts fresh instead of showing its back while its front loads. */}
          <CardWebView key={`${current.id}:${history.length}`} html={revealed ? page.back : page.front} onMessage={onPageMessage} onTap={revealed ? undefined : () => { haptic.select(); reveal(); }} />
        </SwipeCard>
      ) : null}
      {page && extras ? (
        <ScrollView style={{ flexGrow: 0, maxHeight: '45%' }} contentContainerStyle={{ paddingHorizontal: space.l, paddingVertical: space.s }}>{extras}</ScrollView>
      ) : null}
      {page ? null : rendered ? (
        <View style={{ flex: 1 }}>
        <SwipeCard enabled={swipeOn && revealed} cardKey={`${current.id}:${history.length}`} shown={shown} motion={cardMotion} onRate={answer}>
          {/* Tapping the card shows the answer. Not an accessibility element itself: the card's text stays readable, and Show answer is the control VoiceOver uses. */}
          <Pressable accessible={false} disabled={revealed} onPress={() => { haptic.select(); reveal(); }} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: space.xl, paddingTop: space.xxl + space.xl, paddingBottom: playbackFor(rendered, revealed) ? PLAY_BUTTON_CLEARANCE : space.xl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            {/* Keyed to the showing, so each card, and a card shown again, fades in rather than swapping. */}
            <Reveal key={showing} rise={10} style={{ gap: space.xl }}>
              <CardStateChips chip={stateChip(current, { learn: cardParams?.learnSteps ?? DEFAULT_LEARN_STEPS, relearn: cardParams?.relearnSteps ?? DEFAULT_RELEARN_STEPS })} leech={isLeechNote(note)} />
              <Side key={current.id} side={rendered.front} which="front" showHints={showHints} thaiSize={thaiSize} speakSentence={speechLang ? speakSentence : undefined} />
              {reminder ? <MissReminder text={reminder} /> : null}
              {canRecordYourself(rendered) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
                  <RecordYourself rec={self} label="Record" size="card" />
                </View>
              ) : null}
            </Reveal>
            {revealed ? (
              <Reveal rise={14} style={{ gap: space.xl }}>
                <View style={{ height: hairline, backgroundColor: c.border }} />
                <Side key={current.id} side={rendered.back} which="back" showHints={showHints} thaiSize={thaiSize} gloss={note ? glossFor(current, note) : null} speakSentence={speechLang ? speakSentence : undefined} />
                {fragile !== undefined ? <MemoryStrength percent={fragile} /> : null}
                {extras}
              </Reveal>
            ) : null}
          </ScrollView>
          </Pressable>
        </SwipeCard>
        {/* Fixed in the card's bottom right corner, so it's under the thumb whatever the card's length. */}
        {playbackFor(rendered, revealed) ? (
          <PlayButton
            onPlay={() => speak(playbackFor(rendered, revealed))}
            speech={rendered.speechLang}
          />
        ) : null}
        </View>
      ) : null}
    </Screen>
    </View>
  );
}
