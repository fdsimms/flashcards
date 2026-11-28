import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, AppState, Keyboard, Pressable, ScrollView, Text, TextInput, useColorScheme, View } from 'react-native';
import { FLAG_NAMES, flagLabel, noteCards, type CardState } from '../core/cardState';
import { AGENT_FLAG, flagNoteOf, flagReasonOf, withFlagReason, withoutFlag } from '../core/agentFlag';
import { checkFix, chatFixRequest, fixRequest, withFix, type FixRequest, type FixResponse } from '../core/fixCard';
import { autoplayFor, canRecordYourself, isOmnilanguage, playbackFor, renderCard, speechLangFor, type Playback } from '../core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../core/config';
import { cardDeck, cardHomeDeck, deckCardFonts, groupByDeck, heldDue, inheritedSetting, isInDeck, queueInput, treeQueue, untiered } from '../core/deckTree';
import { availableFont, availableFonts } from '../core/fontDownloads';
import { cardFontFor, isBundled, languageChoice } from '../core/fonts';
import { failureText, NOT_IN_ANKI, Refusal } from '../core/failure';
import { boostFor } from '../core/priority';
import { answerParams, isSkillNote } from '../core/skillTag';
import { SkillStopStrip, useStopSuggestion } from './SkillStopStrip';
import { nextStudyDayStart, studyDayKey, studyDayStart } from '../core/day';
import { answerCounts, countKind, isBuried, dueCounts, isInterdayLearning, nextLearningDue, siblingsToBury, studiedToday, type Queue, type StudiedToday } from '../core/queue';
import { ratingsShown, type AnswerButtons } from '../core/answerButtons';
import { becameLeech, DEFAULT_LEARN_STEPS, DEFAULT_LEECH, DEFAULT_RELEARN_STEPS, paramsForDeck, previewIntervals, previewLog, review, type AnswerContext, type RatingValue } from '../core/scheduler';
import { fuzzSeed } from '../core/ankiFuzz';
import { balancerFor, buildLoadSnapshot, forgetCard, loadDayIndex, recordAnswer, type LoadSnapshot } from '../core/loadBalance';
import { ankiToday, fnvHash } from '../core/order';
import { saveLeechHint, saveNote, type NoteStore } from '../anki/noteService';
import { forgetCards, setDueDates, type Rescheduled } from '../anki/rescheduleService';
import { dueDateLabel, parseDueDate } from '../core/reschedule';
import { DEFAULT_THAI_TEXT_SIZE, thaiTextStyle, type ThaiTextSize } from '../core/script';
import { answerTimeMs, bumpStudied, currentCard, keepSessionOrder, nextUndo, sessionProgress, sessionSummary, upNext, type AnswerRecord, type CardAction } from '../core/session';
import { setCardStatesUndoable, undoCardAction } from '../anki/cardUndo';
import { ankiWrites, reviewWrites } from '../core/writeQueue';
import { vacationPlan } from '../core/vacation';
import { durationText } from '../core/stats';
import { secondsPerCard } from '../core/todaySummary';
import { wantedLines } from '../core/synonyms';
import { cardDocument, renderTemplateCard, sideAudio } from '../core/template';
import type { TtsTag } from '../core/tts';
import type { Card, CollectionSettings, DeckParams, DeckSettings, Note, NoteType } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { cardFontsBase } from '../media/cardFonts';
import { useKeyboardInset } from './useKeyboardInset';
import { useKeyboardScroll } from './useKeyboardScroll';
import { downloadedFontsBase } from './fontDownloads';
import { mediaBaseUri, mediaFileUri } from '../media/mediaFiles';
import { mathjaxUri } from '../media/mathjax';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardFontScope, useFontSettings } from './AppFont';
import { useTextFont, useTextSize } from './textMenu';
import { textScale } from '../reader/fonts';
import { CardWebView } from './CardWebView';
import { FaceWarmup } from './FaceWarmup';
import { warmupText } from '../core/faceWarmup';
import { Side } from './CardSide';
import { CardStateChips } from './CardStateChips';
import { LanguageCue } from './LanguageCue';
import { MemoryStrength } from './MemoryStrength';
import { fragilePercent } from '../core/memoryStrength';
import { stateChip } from '../core/stateChip';
import { isLiveLeech } from '../core/leechRecovery';
import { useCardGlosses, type CardGlossing } from './useCardGlosses';
import { useReadingLines } from './useReadingLines';
import { lineWord, withReadingLine } from '../reader/readingLines';
import { capDays } from '../core/cram';
import { useVacationPrefs } from './vacationPrefs';
import { useCrams } from './useCrams';
import { useStudyDay } from './useStudyDay';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { practiceWords } from '../reader/practice';
import { wordsToUse, type WordToUse } from '../reader/production';
import { headword, type DrillRequest } from '../core/forms';
import { AnswerExtras, useReviewForms } from './ReviewForms';
import { SkillBackButton, SkillDrillCard, SkillDrillFooter, useSkillDrill, type Drill } from './SkillDrill';
import { AspectQuestion, AspectResult, useAspectCheck } from './AspectCheck';
import { aspectCheckOn, aspectToCheck } from '../core/aspectCheck';
import { useSkillRelease } from './useSkillRelease';
import { drillOfTags, knownHeadwords, skillLanguageDeck, skillOffer } from '../tools/skills';
import { knownDays, knownMonths } from '../tools/skillWords';
import { haptic } from './haptics';
import { idleRecording, RecordMicButton, RecordYourself } from './RecordYourself';
import { ReviewPitchLine } from './PitchLine';
import { usePageLookUp } from './PageLookUp';
import { useSelfRecording } from './useSelfRecording';
import { htmlToText } from '../core/html';
import { notePreview } from '../core/noteEditing';
import { AgentFlagSheet } from './AgentFlagSheet';
import { LeechHintSheet } from './LeechHintSheet';
import { AskCardSheet } from './AskCardSheet';
import { useSheetQueue } from './useSheetQueue';
import { cardForClaude, withNotesAnswer, type AskTurn, type CardForClaude } from '../core/askCard';
import { addPendingHint, removePendingHint, removePendingHintForCard, type PendingHint } from '../core/pendingHints';
import { asksEarlyHint, canAddMnemonic, hasMnemonic, mnemonicQuestion, type MnemonicQuestion } from '../core/leechHint';
import { PLAY_BUTTON_CLEARANCE, PlayButton, playButtonScrollInsets } from './PlayButton';
import { useOutputWake } from './useOutputWake';
import { stopSpeechIfRunning, usePhoneSpeech } from './usePhoneSpeech';
import { trackPlayer } from './useSoundingButton';
import { missReasonsFor, missReminder } from '../core/misses';
import { AgainSplit, MissReminder } from './MissMarks';
import { useMissMarks } from './useMissMarks';
import { CONFUSED_REASON } from '../core/confusedPairs';
import { canLinkConfused, ConfusedLinkSheet, ConfusedRow } from './ConfusedLink';
import { useConfusedPairs } from './useConfusedPairs';
import { OwnHookField, TypeItButton, useOwnHook } from './ReviewActive';
import { useFieldEdit } from './useFieldEdit';
import { useSenseContrast } from './useSenseContrast';
import { useSenseMarks } from './useSenseMarks';
import { SenseCount, SenseReminder } from './SenseMarks';
import { isSenseMiss, senseCountLabel } from '../core/senseMarks';
import type { AddWord } from './useAddMinedWord';
import { ListeningNote, SpeakButton } from './SpeakButton';
import { spokenAnswerNote } from '../core/speaking';
import { answerKeyboard } from '../core/keyboardLanguage';
import { stripExpected } from '../core/typeAnswer';
import { useKeyboardLanguage } from './useKeyboardLanguage';
import { useSpokenAnswer } from './useSpokenAnswer';
import { languageName } from '../core/voices';
import { TypedDiff } from './TypedDiff';
import { SessionMissList, useSessionMisses, type PracticeRequest } from './SessionMisses';
import { useNewWordsStep } from './useNewWords';
import { reviewMenu } from './ReviewMenu';
import { useMiniCram } from './useMiniCram';
import { NextSteps, type NextStep } from './ReviewNextSteps';
import { asksOwnHook, spokenMiss, typedMiss, typeItAnswer, typeItAnswers } from '../core/activeRecall';
import { compareTyped, compareTypedAnswer } from '../core/typedCompare';
import { cardWordRuns } from '../core/furigana';
import { useFurigana } from './useFurigana';
import { Button, Count, Icon, Loading, ProgressBar, Screen, Tappable } from './kit';
import { Pop, Reveal } from './motion';
import { LastAnswerLine, buttonHaptic, useLastAnswer } from './ChangeRating';
import { HoldStrip, useHoldOffer } from './HoldUndo';
import { MissMnemonicCover, useMissMnemonic } from './MissMnemonic';
import { missMnemonic } from '../core/missMnemonic';
import { AnswerTimer } from './AnswerTimer';
import { useTimebox } from './useTimebox';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme, readable } from './theme';
import { useHeaderInset } from './useHeaderInset';

import { leadingEmoji, studiedSubdecks, subdeckOf } from '../core/deckBadge';
import { useDeckTint } from './useDeckTint';
import type { CardLanguage } from './LanguagePill';
import { CardSurface, SwipeCard, type CardMotion } from './SwipeCard';
import { ReviewFooter, FOOTER_BUTTON_HEIGHT } from './ReviewFooter';
import { afterPaint, painted } from './afterPaint';
import { useAnswerTiming } from './useAnswerTiming';
import { MissingKeyboardNote } from './useMissingKeyboard';
import { READABLE_WIDTH } from '../core/wide';
import { Figure } from './Figure';
export { CardSurface };

/** The audio mode Review plays in (AppContext's), put back after Record yourself records. */
const AUDIO_MODE = { playsInSilentMode: true };
// How long a recording may take to report playing before Review starts it again on a fresh player.
const RECORDING_START_WAIT_MS = 900;

/** What this session did, shown when the queue is empty: cards answered, time, and how many were Again. */
/** A sheet Review can raise (src/ui/useSheetQueue.ts); the key makes asking twice for the same one a single sheet. */
type ReviewSheet =
  | { key: string; kind: 'leech'; noteId: string; misses?: number; suspendedCardId?: string; step?: { n: number; of: number } }
  | { key: string; kind: 'confused'; noteId: string }
  | { key: string; kind: 'ask'; card: CardForClaude }
  | { key: string; kind: 'agentFlag'; noteId: string; cardId: string };
const confusedSheetFor = (noteId: string): ReviewSheet => ({ key: `confused:${noteId}`, kind: 'confused', noteId });

function SessionSummary({ history, delay = 0 }: { history: AnswerRecord[]; delay?: number }) {
  const c = useTheme();
  const { answered, again, takenMs } = sessionSummary(history);
  const pace = secondsPerCard(answered, takenMs);
  // The counts run up from 0 once the summary has appeared (the end of a session is a small payoff).
  const [counting, setCounting] = useState(false);
  useEffect(() => { const t = setTimeout(() => setCounting(true), delay + 80); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const tile = (value: string | number, label: string) => (
    <Figure centered value={typeof value === 'number' && !counting ? 0 : value} label={label} style={{ flex: 1 }} />
  );
  return (
    <View
      accessible
      accessibilityLabel={`This session: ${answered} ${answered === 1 ? 'card' : 'cards'}, ${durationText(takenMs)}${pace ? `, ${pace} seconds per card` : ''}, ${again} answered Again`}
      style={{ flexDirection: 'row', alignSelf: 'stretch', marginTop: space.xl, paddingVertical: space.l, borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border }}
    >
      {tile(answered, answered === 1 ? 'card' : 'cards')}
      {tile(durationText(takenMs), 'studying')}
      {pace ? tile(`${pace} s`, 'per card') : null}
      {tile(again, 'Again')}
    </View>
  );
}

/**
 * Studies `deck` and its subdecks. Each card is scheduled with its own deck's FSRS settings, and
 * every deck's daily limits apply (`treeQueue`). Omnilanguage cards render natively with TTS;
 * other note types render their Anki templates in a WebView.
 */
export function Review({ repo, deck, practice, extraCard, suggestHints, askAboutCard, fixFlaggedCard, glossing, onAddWord, reloadKey, onDone, onEditNote, onPracticeForms, onPracticeMisses, onNextDeck, nextDeck, onEarlierDeck, earlierDeck, onCustomStudy, onSkillCards, onBrowse, onCardInfo, onSettings , agentFlags}: {
  repo: Repo & AnkiLink;
  deck: string;
  /** Whether a card can be flagged for Claude to check: only with sync on, which is how the MCP reaches the collection. */
  agentFlags: boolean;
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
  /** Present while Read & Listen is signed in: suggests a fix for a flagged card (AgentFlagSheet's Fix with Claude now). */
  fixFlaggedCard?: (request: FixRequest) => Promise<FixResponse>;
  /** Present while Read & Listen is signed in: an example sentence's words can be tapped for their meanings (useCardGlosses). */
  glossing?: CardGlossing;
  /** Add to deck, as every screen offers it (useAddMinedWord): what Add does in a card's "not this word" box. */
  onAddWord?: (add: AddWord) => Promise<boolean>;
  /** Changes when something outside this screen may have changed the deck (custom study): loads the cards again. */
  reloadKey?: number;
  /** Leaves the screen: the deck is done. */
  onDone: () => void;
  /** Opens the note editor over this screen, calling `onClose` with what happened. */
  onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  /** Opens a forms drill (src/ui/FormsDrill.tsx) over this screen. */
  onPracticeForms: (request: DrillRequest) => void;
  /** Opens Similar words (src/ui/tools/MixupsTool.tsx) on words missed this session. */
  onPracticeMisses?: (request: PracticeRequest) => void;
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
  /** Add skill cards to the deck (SkillCards.tsx), offered at the end of a session when its language has some and it has none. */
  onSkillCards?: () => void;
  /** Opens Browse narrowed to this deck, from the end-of-session list and the card menu. */
  onBrowse: () => void;
  /** Opens Card Info (src/ui/CardInfo.tsx) for a card. */
  onCardInfo: (cardId: string) => void;
  /** Opens the card settings (Settings, Decks and cards) from the header's menu. */
  onSettings: () => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  // Which font each card of a deck that cycles its fonts gets is worked out from the card and this number, so it holds while the screen is open and changes the next time.
  const [fontSession] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const appFont = useFontSettings();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  // The sheets Review raises, one at a time (src/core/sheetQueue.ts): iOS drops a sheet asked for
  // while another is on screen. A leech's hint sheet is asked for from the summary, one per leech
  // made in the session, and names the card when its answer suspended it, so saving a hint can bring
  // it back; it also opens from Write a mnemonic in the ⋯ menu, with no misses to report. The link sheet is for
  // words mixed up, and Ask Claude's is for the card it was opened for, as text.
  // A leech made in this session doesn't stop the review: it waits in `pendingHints` for the
  // summary's row, which raises one hint sheet after another (src/core/pendingHints.ts).
  const sheets = useSheetQueue<ReviewSheet>();
  const [pendingHints, setPendingHints] = useState<PendingHint[]>([]);
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
  const [senseCountOn, setSenseCountOn] = useState(true);
  const [thaiSize, setThaiSize] = useState<ThaiTextSize>(DEFAULT_THAI_TEXT_SIZE);
  const furigana = useFurigana(repo, collection.dayStartsAtHour);
  // Bumped after the note editor saves or deletes, to load the cards and notes again.
  const [reloads, setReloads] = useState(0);
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [deckSettings, setDeckSettings] = useState<Map<string, DeckSettings>>(new Map());
  // The showing whose answer is shown (below): any other card, whatever brought it on (an answer, a
  // reload after the note editor, a learning card coming due), starts with its question.
  const [revealedAt, setRevealedAt] = useState<string>();
  const [now, setNow] = useState(() => new Date());
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  // What the menu did to cards (bury, suspend, flag, Set Due Date, Forget), for Undo alongside the answers (`nextUndo`).
  const [actions, setActions] = useState<CardAction[]>([]);
  // A card marked to come back a few more times this session (src/core/miniCram.ts): practice, never a rating.
  const cram = useMiniCram();
  const undone = useRef(new WeakSet<AnswerRecord>());
  // How many answer writes have failed, and the count the "answers after it" alert was last shown for.
  const failedWrites = useRef(0);
  const toldDropped = useRef(0);
  const [preferId, setPreferId] = useState<string>();
  // Just after an answer: the card the queue expected next (`upNext`) is shown at once, from the queue
  // as it was, and the queue and the lookalike hold are rebuilt from the answer once that card is on
  // screen (below), so they don't hold it up. Held for the answer it followed (`at`, the answers given),
  // so an undo meanwhile drops it. `preferId` keeps that card on screen once the queue is rebuilt.
  const [settling, setSettling] = useState<{ at: number; next: Card; queue: Queue; cards: Card[]; now: Date } | null>(null);
  const settle = settling && settling.at === history.length ? settling : null;
  useEffect(() => (settling ? afterPaint(() => setSettling(null)) : undefined), [settling]);
  // Show answer timing, in the ⋯ menu (useAnswerTiming.ts).
  const timing = useAnswerTiming();
  // The line above the answer buttons offering Undo, or to change the last answer to Good or Again (ChangeRating.tsx).
  const lastAnswer = useLastAnswer();
  const holdOffer = useHoldOffer();
  // A missed card's mnemonic, held over the next card until Continue (MissMnemonic.tsx).
  const missCover = useMissMnemonic();
  // Anki's session time limit, from the collection's settings (useTimebox.ts).
  useTimebox(collection.timeLimitSecs, history.length, onDone);
  // Set while an answer or an undo is being written. A second tap during the await would
  // otherwise act on the same card again from its old state.
  const busy = useRef(false);
  // The card's motion (SwipeCard's): an answer flashes its color. An undone card just appears.
  const cardMotion = useRef<CardMotion | null>(null);
  // The offstage card's (below), so a card not on screen never takes over the flash.
  const offstageMotion = useRef<CardMotion | null>(null);
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
      const [c, n, reviews, revlog, params, types, settings, buttons, swipe, hints, thai, senseCount] = await Promise.all([
        // Every card, not only this deck's: a gate on a deck above this one counts its whole subtree.
        repo.listCards(), repo.listNotes(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
        repo.listDeckParams(), repo.listNoteTypes(), repo.listDeckSettings(), repo.answerButtons(), repo.swipeToRate(), repo.showCardHints(), repo.thaiTextSize(), repo.showSenseCount(),
      ]);
      if (stale) return;
      if (writes.current !== seen) { setReloads((k) => k + 1); return; }
      // Anki's own counts of what each deck has studied today, which know where an answer was given (`studiedToday`).
      const ankiDay = ankiToday(now, cs.dayStartsAtHour, cs.collectionCreated, cs.creationOffset);
      const ankiCounters = ankiDay === undefined ? undefined : await repo.ankiDeckStudied(ankiDay);
      if (stale) return;
      const today = studiedToday({ notes: n, cards: c, reviews, revlog, now, dayStartsAtHour: cs.dayStartsAtHour, ankiCounters: ankiCounters?.length ? ankiCounters : undefined });
      loadedDay.current = studyDayKey(now, cs.dayStartsAtHour);
      setCollection(cs);
      // The queue reads the day from `now`: a reload after a while away (or past the day's start) needs it fresh too.
      setNow(now);
      setAnswerButtons(buttons);
      setSwipeOn(swipe);
      setShowHints(hints);
      setSenseCountOn(senseCount);
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
  // While settling, as the queue being shown was built: the hold is rebuilt with the queue.
  const forms = useReviewForms(repo, { cards: settle?.cards ?? cards, notes, deckSettings, now: settle?.now ?? now, dayStartsAtHour: H, settling: !!settle });
  // The reasons chosen on Again, and the "Last time" reminder they bring back (src/core/misses.ts).
  const misses = useMissMarks(repo);
  // Words linked as ones that get mixed up (src/core/confusedPairs.ts), and the sheet that links one.
  const confused = useConfusedPairs(repo);
  const vacation = useVacationPrefs();
  // Running crams: a review of one of their words isn't put off past the cram's day (src/core/cram.ts).
  const { crams } = useCrams(repo as NoteStore);
  const deckOf = useMemo(() => new Map([...notes.values()].map((n) => [n.id, n.deck])), [notes]);
  // The queue as last built, for this deck and study day: each rebuild keeps its order (`keepSessionOrder`).
  const sessionQueue = useRef<{ key: string; queue: Queue } | undefined>(undefined);
  const rebuilt = useMemo(() => {
    if (!cards || settle) return null;
    const started = performance.now();
    const key = `${deck}:${studyDayKey(now, H)}`;
    const q = keepSessionOrder(sessionQueue.current?.key === key ? sessionQueue.current.queue : undefined, treeQueue(deck, queueInput({
      notes: notes.values(), cards, params: allParams, studied, gateFor: (d) => deckSettings.get(d)?.gateCap, ownLimitsFor: (d) => deckSettings.get(d), collection, now, held: forms.held, vacation, boostFor: boostFor({ notes: notes.values(), settings: deckSettings, now }), batchBySubdeck: inheritedSetting(deck, deckSettings, 'batchBySubdeck'),
    })));
    sessionQueue.current = { key, queue: q };
    timing.queueTook(performance.now() - started);
    return q;
  }, [cards, notes, allParams, studied, deckSettings, collection, deck, now, forms.held, vacation, settle]); // eslint-disable-line react-hooks/exhaustive-deps
  const queue = settle ? settle.queue : rebuilt;
  // Reviews a lookalike seen today holds until tomorrow, for the done screen (`heldDue`).
  const heldToday = useMemo(() => (cards ? heldDue(deck, groupByDeck(cards, deckOf), forms.held, now, H) : 0), [cards, deckOf, deck, forms.held, now, H]);
  // While settling, `queue` still holds the card just answered, so a bar worked out from it would move
  // once on that count and again when the queue is rebuilt. It holds still until the rebuilt queue is in.
  const progressRef = useRef(0);
  if (queue && !settle) progressRef.current = sessionProgress(history.length, queue.due.length + queue.fresh.length);
  useEffect(() => { timing.flush(); }, [rebuilt]); // eslint-disable-line react-hooks/exhaustive-deps

  const queueCurrent = settle ? settle.next : queue ? currentCard(queue, preferId) : undefined;
  // A mini cram return takes the screen until it's answered; the card is the one in `cards`, as its answer left it.
  const returned = cram.showing ? cards?.find((cd) => cd.id === cram.showing && !cd.suspended && !cd.retired && !isBuried(cd, now, H)) : undefined;
  const current = returned ?? queueCurrent;
  // Part of every showing's key: a return adds no answer to `history`, so the same card shown twice running would keep its WebView.
  const turn = history.length + cram.returnsAnswered;
  // The count the card on screen is in, underlined in the header's counts.
  const shownCount = current ? countKind(current) : undefined;
  // Each showing of a card: the same card back again (after Again, with nothing else left, or an undo)
  // is a new showing, timed, spoken and faded in afresh, as the WebView's key below does for a template card.
  // `history.length` goes back down on an undo, so card:turn alone repeats an earlier showing's key (answer A, undo, A is "A:5" again)
  // and whatever was keyed to that one came back with it: a drill already marked three of three, with buttons that mark nothing.
  // A count of key changes makes every showing's key new.
  const turnKey = current ? `${current.id}:${turn}` : undefined;
  const showingSeq = useRef({ key: turnKey, n: 0 });
  if (showingSeq.current.key !== turnKey) showingSeq.current = { key: turnKey, n: showingSeq.current.n + 1 };
  const showing = turnKey && `${turnKey}#${showingSeq.current.n}`;
  const revealed = !!showing && revealedAt === showing;
  // The back is committed: time the flip to the frames after it (a no-op unless timing is on).
  useEffect(() => { if (revealed) timing.revealShown(); }, [revealed]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = current ? notes.get(current.noteId) : undefined;
  // Tagged a leech and not recovered since (`isLiveLeech`): Anki's tag stays on a recovered word, the chip doesn't.
  const liveLeech = useMemo(() => !!note && isLiveLeech(note, cards?.filter((c) => c.noteId === note.id) ?? []), [note, cards]);
  // A skill card's drill (SkillDrill.tsx): its questions run in the card, then it's rated like any card.
  // A dates drill asks only about the months and days whose words the deck knows, settled cards (src/tools/skillWords.ts).
  const drill = useMemo((): Drill | undefined => {
    const found = note ? drillOfTags(note.tags) : undefined;
    if (!found || found.step.group !== 'dates' || !cards) return found;
    const known = knownHeadwords(notes.values(), cards, skillLanguageDeck(note!.deck));
    return { ...found, months: knownMonths(found.language, known), days: knownDays(found.language, known) };
  }, [note, notes, cards]);
  const skill = useSkillDrill(showing, drill, current ? String(current.id) : undefined, ratingsShown(answerButtons).includes(2), H);
  // What releasing wrote, taken into the open session: a step set aside leaves it, and a drill card brought into the week can come up.
  useSkillRelease(repo, cards, notes, H, useCallback((saved: Card[], savedNotes: Note[]) => {
    if (savedNotes.length) setNotes((prev) => { const next = new Map(prev); for (const n of savedNotes) next.set(n.id, n); return next; });
    const byId = new Map(saved.map((cd) => [cd.id, cd]));
    setCards((prev) => prev && prev.map((cd) => byId.get(cd.id) ?? cd));
  }, []));
  // After a drill card's sixth clean week, an offer to stop practicing its step (SkillStopStrip.tsx).
  const stopSuggestion = useStopSuggestion(repo, H, useCallback((n: Note, ids: string[]) => {
    setNotes((prev) => new Map(prev).set(n.id, n));
    const stopped = new Set(ids);
    setCards((prev) => prev && prev.map((cd) => (stopped.has(cd.id) ? { ...cd, suspended: true } : cd)));
  }, []));
  // The aspect check on a Russian or Polish verb's front (AspectCheck.tsx): optional, and only outlines a rating.
  const aspectCheck = useAspectCheck(showing, current && note && aspectCheckOn(note.deck, deckSettings) ? aspectToCheck(note, current) : undefined);
  // A miss on the aspect check suggests Hard; with Hard turned off it's Again, the button that's there.
  const suggestedRating = skill.suggested ?? (aspectCheck.suggested === 2 && !ratingsShown(answerButtons).includes(2) ? 1 : aspectCheck.suggested);
  const glossFor = useCardGlosses(glossing, queue?.order, notes);
  // Look it up on an Anki-template card: a word held, or tapped on the answer side (PageLookUp.tsx).
  const pageLookUp = usePageLookUp(glossing, current, note);
  useEffect(() => { forms.showing({ card: current, note, revealed }); }, [current, note, revealed, forms.showing]); // eslint-disable-line react-hooks/exhaustive-deps
  // A deck that holds several languages (Languages: Polish, Thai, German...) marks each card with its own. A frequency tier ("Thai::Tier 3") is part of its language, not a language of its own, so it's looked past.
  const tintOf = useDeckTint();
  // Every card's home deck: from the cards the queue being shown was built from, so it waits with the queue.
  const deckCards = settle?.cards ?? cards;
  const subdecks = useMemo(() => studiedSubdecks((deckCards ?? []).map((cd) => untiered(cardHomeDeck(cd, deckOf.get(cd.noteId) ?? ''))), deck), [deckCards, deckOf, deck]);
  const cardLanguage = useMemo((): CardLanguage | undefined => {
    const sub = current && note ? subdeckOf(untiered(cardHomeDeck(current, note.deck)), deck) : null;
    if (!sub || subdecks.size < 2) return undefined;
    const { emoji, rest } = leadingEmoji(sub.slice(sub.lastIndexOf('::') + 2));
    return { emoji, name: rest, wash: tintOf(sub) };
  }, [current, note, deck, subdecks, tintOf]);
  // The card's own deck decides its FSRS settings, not the deck being studied.
  // A drill card's maximum interval is a week (`answerParams`), whatever its preset says.
  const cardParams = note && current ? answerParams(paramsForDeck(cardHomeDeck(current, note.deck), allParams), note) : undefined;
  // A shaky review card says so on its answer (display only: nothing here reads into the rating or the queue).
  const fragile = revealed && current ? fragilePercent(current, new Date(), cardParams?.weights ?? []) : undefined;
  const noteType = note && current?.kind.startsWith('t') && !isOmnilanguage(note) ? noteTypes.get(note.model) : undefined;
  // What's typed into a {{type:}} card's box, compared on the back once the answer is shown.
  const [typed, setTyped] = useState('');
  // The box sits in the footer, so the screen is padded by the keyboard's height while it's up. The
  // keyboard covers the home indicator area the footer already leaves, so that much isn't added twice.
  const insets = useSafeAreaInsets();
  const header = useHeaderInset();
  const keyboard = useKeyboardInset();
  // Editing a card's Notes or Mnemonic in place is the other way the keyboard comes up: the footer stays put under
  // it (padding the screen would lift the buttons and squeeze the card to a sliver), and the card scrolls the box clear.
  const cardScroll = useKeyboardScroll();
  // The own-hook box on the back is a Mnemonic box too, so it takes the same layout (`typingInCard` below).
  const [hookFocused, setHookFocused] = useState(false);
  const typedShown = revealed ? typed : '';
  // The card's preset says whether a template card's sounds and {{tts:}} play on their own (Anki's autoplay).
  const autoplay = cardParams?.autoplay ?? true;
  // The font this card is set in: its deck's cycle, else the font chosen for its language (the Text menu), else the app's font when cards use it, else the system font (`cardFontFor`).
  const fontOf = (card: Card, n: Note) => {
    const pool = availableFonts(deckCardFonts(cardHomeDeck(card, n.deck), deckSettings), appFont.installed);
    const chosen = languageChoice(appFont.settings, speechLangFor(n));
    return cardFontFor(pool, card.id, fontSession) ?? (chosen ? availableFont(chosen, appFont.installed) : undefined) ?? (appFont.settings.onCards ? appFont.font : 'system');
  };
  const cardFont = note && current ? fontOf(current, note) : appFont.settings.onCards ? appFont.font : 'system';
  // The Text menu's font rows, for the card's language. A deck with fonts of its own keeps them, so the menu has none for its cards.
  const [textSize, chooseTextSize] = useTextSize();
  const cardText = useTextFont(note ? speechLangFor(note) : undefined);
  const deckOwnsFont = !!note && !!current && deckCardFonts(cardHomeDeck(current, note.deck), deckSettings).length > 0;
  /**
   * A template card's sides as pages, or undefined for a card that renders natively. The card showing
   * and the one loaded ahead of it (below) both come from here, so the page loaded ahead is the very
   * page shown once that card comes up, and its WebView has nothing to load.
   */
  const templatePage = (card: Card | undefined, typedIn: string) => {
    const n = card && notes.get(card.noteId);
    const model = n && card.kind.startsWith('t') && !isOmnilanguage(n) ? noteTypes.get(n.model) : undefined;
    if (!card || !n || !model) return undefined;
    const ord = Number(card.kind.slice(1));
    const { front, back, typeAnswer } = renderTemplateCard(n, model, ord, typedIn, card);
    const font = fontOf(card, n);
    const opts = {
      css: model.css, ord, dark, autoplay: paramsForDeck(cardHomeDeck(card, n.deck), allParams)?.autoplay ?? true,
      mediaBase: mediaBaseUri(), mathjax: mathjaxUri(),
      colors: { background: c.surface, text: c.text, cloze: c.countNew },
      font: font === 'system' ? undefined : { id: font, base: isBundled(font) ? cardFontsBase() : downloadedFontsBase() },
      language: speechLangFor(n), thai: thaiTextStyle(thaiSize), scale: textScale(textSize),
    };
    return { front: cardDocument(front, opts), back: cardDocument(back, opts), typeAnswer, frontAudio: sideAudio(front), backAudio: sideAudio(back) };
  };
  // This memo and aheadPage's below render the same page, so they take the same inputs: keep their dependency lists in step.
  const page = useMemo(() => templatePage(current, typedShown), [note, noteType, current?.id, current?.kind, dark, c, typedShown, autoplay, cardFont, thaiSize, textSize]); // eslint-disable-line react-hooks/exhaustive-deps
  // The next card's question, loaded out of sight while this one is studied, so a template card
  // comes up without a blank card while its page loads. After a native card too (a Basic skill card in a
  // Languages deck comes after word cards): the WebView slot below is then kept offstage just to hold it.
  // A drill card draws natively (SkillDrillCard), so it has no page to load. Not while settling: that
  // queue still has the card just answered in it.
  const upcoming = queue && !settle ? upNext(queue, current) : undefined;
  const upcomingNote = upcoming && notes.get(upcoming.noteId);
  const ahead = upcomingNote && !drillOfTags(upcomingNote.tags) ? upcoming : undefined;
  const aheadPage = useMemo(
    () => templatePage(ahead, ''),
    [ahead?.id, ahead?.kind, notes, noteTypes, allParams, deckSettings, dark, c, appFont, thaiSize, textSize], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Which word a reverse card wants when other notes share its meaning (synonyms.ts), from every note loaded.
  const wanted = useMemo(() => wantedLines(notes.values()), [notes]);
  const readingLineFor = useReadingLines(glossing, queue?.order, notes);
  // The card as drawn, its answer side with a line from a text read under the note's own example (reader/readingLines.ts).
  const rendered = useMemo(() => {
    const drawn = current && note && !page ? renderCard(note, current.kind, wanted.get(note.id)) : undefined;
    return drawn ? { ...drawn, back: { ...drawn.back, blocks: withReadingLine(drawn.back.blocks, readingLineFor(current!, note!), lineWord(note!)) } } : undefined;
  }, [current, note, page, wanted, readingLineFor]);
  // A numbered Meaning's senses, tapped as missed on the answer and reminded about next time (src/core/senseMarks.ts).
  const senseMarks = useSenseMarks(showing, rendered, current ? misses.log.get(current.id) : undefined);
  // The card's word with its reading over its kanji once the answer shows (Settings, Furigana), whichever side it's on.
  const wordRuns = rendered ? cardWordRuns([...rendered.front.blocks, ...rendered.back.blocks], furigana) : null;
  // The fuzz seed and load balancer for answering the current card, as Anki has them: the buttons show what an answer does.
  const baseContext = (card: Card, when: Date, params = cardParams): AnswerContext => {
    const seed = fuzzSeed(card.ankiId, card.sched.reps) ?? BigInt.asUintN(64, fnvHash(card.id) + BigInt(card.sched.reps));
    // A card in a filtered deck has no preset there, so Anki fuzzes it without balancing.
    const balance = collection.loadBalancer === false || card.filteredDeck ? undefined : balancerFor(loadSnapshot.current, card, {
      preset: params?.presetId, seed, easyDays: params?.easyDays, buryReviews: !!params?.bury?.reviews,
      nextDayAt: nextStudyDayStart(when, H),
    });
    return { seed, dayStartsAtHour: H, balance, capDays: capDays(crams, notes.get(card.noteId), when, H) };
  };
  // What Good would bring the current card back in, counted from `from` (a lookalike) or its last review.
  const goodFrom = (from?: Date) => (current ? previewIntervals(current.sched, now, cardParams, { ...baseContext(current, now), countFrom: from })[3] : '');
  // A lookalike may have given the answer away: counted from when it was seen, unless turned off, or unless
  // that wouldn't change Good's interval (the offer isn't shown then, so it mustn't apply unseen).
  const soonerApplies = !!forms.countFrom && goodFrom(forms.countFrom) !== goodFrom();
  const answerContext = (card: Card, when: Date, params = cardParams): AnswerContext => ({
    ...baseContext(card, when, params), countFrom: card.id === current?.id && soonerApplies ? forms.countFrom : undefined,
  });
  const intervals = current && revealed ? previewIntervals(current.sched, now, cardParams, answerContext(current, now)) : undefined;

  // One player for the session's recorded audio, released when the screen closes.
  const player = useRef<AudioPlayer | null>(null);
  const phoneSpeech = usePhoneSpeech(repo);
  const wake = useOutputWake();
  const untrackPlayer = useRef<(() => void) | null>(null);
  useEffect(() => () => { untrackPlayer.current?.(); untrackPlayer.current = null; player.current?.remove(); player.current = null; Speech.stop(); }, []);

  /**
   * Plays what `playbackFor` / `autoplayFor` chose: the note's recording when it's allowed and the
   * file is here, as Anki plays it, else the phone's text-to-speech voice.
   */
  // Stopping speech that isn't running can pull the audio session out from under the recording that
  // starts right after, so ask the voice whether it is speaking rather than keep a flag nothing clears.
  // Record yourself: a take of your own voice for this card, played back next to its recording.
  // Compare plays the card's recording before the take, so it's offered only with that file here.
  const recordingUri = useMemo(() => (rendered?.audioFile ? mediaFileUri(rendered.audioFile) : undefined), [rendered?.audioFile]);
  const self = useSelfRecording(current?.id ?? null, AUDIO_MODE, {
    onBeforeAudio: () => {
      void stopSpeechIfRunning();
      player.current?.pause();
    },
    original: recordingUri ? () => ({ source: { uri: recordingUri } }) : null,
  });
  // Coming back to the app after an interruption (a notification's sound, a call) starts the audio session again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') setAudioModeAsync(AUDIO_MODE).catch(() => undefined); });
    return () => sub.remove();
  }, []);
  // Only the latest request plays: one that was waiting on the voice to stop must not speak over, or after, a newer one.
  const speakSeq = useRef(0);
  const speak = useCallback(
    async (what: Playback | undefined) => {
      const mine = ++speakSeq.current;
      if (!what || !rendered) return;
      self.stopTake();
      await stopSpeechIfRunning();
      // A notification, call or alarm can end the app's audio session, and nothing starts it again: set the mode
      // each time so the voice and the player are never left on a dead one.
      await setAudioModeAsync(AUDIO_MODE).catch(() => undefined);
      if (mine !== speakSeq.current) return;
      phoneSpeech.cancelPending();
      player.current?.pause();
      const uri = what.file ? mediaFileUri(what.file) : undefined;
      if (uri) {
        // Bluetooth headphones that have been quiet lose the start of the next sound, all of a word (useOutputWake).
        await wake();
        if (mine !== speakSeq.current) return;
        // Keep the session active between clips: reactivating it for each one sometimes stalled the next.
        // A recording iOS took and never played (random, not tied to a file) is started again on a fresh
        // player and a fresh audio session, up to twice. It counts as started when the player reports
        // playing, so a clip that already ended isn't repeated.
        const start = (retries: number) => {
          if (!player.current) {
            player.current = createAudioPlayer(null, { keepAudioSessionActive: true });
            untrackPlayer.current = trackPlayer(player.current);
          }
          const p = player.current;
          let started = false;
          const sub = p.addListener('playbackStatusUpdate', (st) => { if (st.playing) started = true; });
          p.replace({ uri });
          p.play();
          setTimeout(() => {
            sub.remove();
            if (started || retries <= 0 || mine !== speakSeq.current || player.current !== p) return;
            untrackPlayer.current?.(); untrackPlayer.current = null;
            try { p.remove(); } catch { /* released */ }
            player.current = null;
            setAudioModeAsync(AUDIO_MODE).catch(() => undefined).then(() => { if (mine === speakSeq.current) start(retries - 1); });
          }, RECORDING_START_WAIT_MS);
        };
        start(2);
        return;
      }
      if (!what.text) return;
      phoneSpeech.sayWord(what.text, rendered.speechLang);
    },
    [rendered, phoneSpeech, self.stopTake, wake],
  );

  // The Example sentence's speaker button: the phone's voice for the note's language, at the speed chosen
  // for it (Settings, Voices). Never the note's recording, which is of the word and not the sentence.
  const speechLang = rendered?.speechLang;
  const speakSentence = useCallback((text: string) => {
    if (!speechLang) return;
    self.stopTake();
    player.current?.pause();
    phoneSpeech.sayLine(text, speechLang, false);
  }, [speechLang, phoneSpeech, self.stopTake]);

  // Anki's {{tts:}} tags, read with the phone's voices: on their own when a side without a
  // recording is shown and the preset autoplays (a recording plays instead, in the page), and
  // from each play button.
  const readAloud = useCallback((tags: TtsTag[]) => {
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
  // A template card's answer is read by its script, kanji alone in a Japanese note as Japanese (`answerKeyboard`).
  const typedTag = rendered?.speechLang ?? (typeInExpected ? answerKeyboard(stripExpected(typeInExpected), note ? speechLangFor(note) : undefined) : undefined);
  const typedKeyboard = useKeyboardLanguage(typedTag);
  // The card Answer by speaking started on: its saved audio becomes Record yourself's take only if that is still the card (`self.adopt`).
  const listenedFor = useRef<string | null>(null);
  const spoken = useSpokenAnswer(rendered?.speechLang, {
    expected: rendered && note && current ? typeItAnswers(note, current) : undefined,
    onBeforeListen: () => { Keyboard.dismiss(); self.stop(false); listenedFor.current = current?.id ?? null; },
    onHeard: (text) => { setTyping(true); setSpokenIn(true); setTyped(text); },
    // One microphone for both: on a card with a recording to compare against, what's said is also the take.
    keepTake: !!rendered && canRecordYourself(rendered),
    onTake: (uri) => self.adopt(uri, listenedFor.current),
  });
  useEffect(() => { spoken.cancel(); }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps
  const ownHook = useOwnHook(repo, showing, useCallback((n: Note) => setNotes((prev) => new Map(prev).set(n.id, n)), []));
  const fieldEdit = useFieldEdit(repo, writes, useCallback((n: Note) => setNotes((prev) => new Map(prev).set(n.id, n)), []));
  // The "not this word" box under an answer's Sense (useSenseContrast.ts).
  const contrast = useSenseContrast({
    repo, writes, card: current, note, decks: glossing?.decks, addWord: onAddWord,
    onOpenNote: (noteId, closed) => onEditNote({ noteId }, (result) => { if (result) closed(); }),
    onSaved: useCallback((n: Note) => setNotes((prev) => new Map(prev).set(n.id, n)), []),
  });
  // The session end's list of misses, and what of them Similar words can practice (SessionMisses.tsx).
  const sessionMisses = useSessionMisses(history, notes, cards, !!onPracticeMisses, noteTypes, confused.pairs, !current || !note || (!rendered && !page));
  const newWordsStep = useNewWordsStep(deck, c.teal);

  // A natively drawn card is on screen the frame after it's committed (a template card says so itself: CardWebView's onShown).
  useEffect(() => {
    if (!timing.on || !showing || page) return;
    const frame = requestAnimationFrame(() => timing.shown(showing));
    return () => cancelAnimationFrame(frame);
  }, [showing, timing.on]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-speak the front when a card with audio appears.
  useEffect(() => {
    if (rendered) speak(autoplayFor(rendered, false));
  }, [showing]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Whether a mini cram return may show this card: it's still there and not held back, as `changed` left it. */
  const usableAfter = (changed: Map<string, Card>, pool: Card[]) => (id: string) => {
    const cd = changed.get(id) ?? pool.find((x) => x.id === id);
    return !!cd && !cd.suspended && !cd.retired && !isBuried(cd, new Date(), H);
  };

  /** Missed it or Got it on a mini cram return: nothing is scheduled or written, and it isn't in undo. */
  const answerReturn = (card: Card, got: boolean) => {
    haptic.answer();
    cardMotion.current?.flash(got ? 3 : 1);
    cram.returned(card.id, got, !queueCurrent, usableAfter(new Map(), cards ?? []));
    setRevealedAt(undefined);
  };

  /**
   * Answers the card on screen. `redo` answers a card that isn't on screen instead: Change to Good or Again
   * answers the card it just undid, in the same step as the undo, so that card never comes back
   * to the screen between the two. The caller then holds `busy`, and `cards` is the list with that
   * card (and the siblings its first answer buried) put back as they were.
   */
  const answer = async (rating: RatingValue, miss?: string, redo?: { card: Card; note: Note; cards: Card[]; takenMs: number }) => {
    // A mini cram return is practice: Missed it or Got it, with nothing written and nothing scheduled.
    if (!redo && returned && current === returned) { answerReturn(returned, rating > 1); return; }
    const cur = redo ? redo.card : current;
    const nt = redo ? redo.note : note;
    const params = redo ? answerParams(paramsForDeck(cardHomeDeck(redo.card, redo.note.deck), allParams), redo.note) : cardParams;
    const pool = redo ? redo.cards : cards ?? [];
    if (!cur || !nt) return;
    if (!redo && (busy.current || cur === lastAnswered.current)) return;
    if (!redo) busy.current = true;
    if (!redo) skill.rated(rating);
    else skill.redone(String(cur.id), rating);
    // A reason is kept with Again only; a missed sense with whichever rating was pressed (senseMarks.ts). Neither reaches the scheduler.
    // With a sense marked and no reason chosen, the marks are the reason, for a button and a swipe alike.
    const said = miss ?? (redo ? undefined : senseMarks.miss);
    const keptMiss = said && (rating === 1 || isSenseMiss(said)) ? said : undefined;
    const timed = redo ? null : timing.pressed(`${cur.id}:${turn}`);
    if (!redo) haptic.answer();
    if (!redo) cardMotion.current?.flash(rating);
    try {
      // Rebuilding the queue for the next card blocks JS for a while on a big deck, and the haptic's
      // native call isn't sent until that's done. One frame here lets the haptic and the flash out first.
      if (!redo) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const when = new Date();
      // A filtered deck that doesn't reschedule only previews: the card's schedule stays as it
      // was, and it goes home to its own deck (Anki would show it again after a short delay first).
      const filtered = cur.filteredDeck ? paramsForDeck(cur.filteredDeck, allParams)?.filtered : undefined;
      const preview = filtered?.reschedule === false;
      // Again, Hard and Good show a previewed card again after the deck's delay; Easy, or a delay of 0, finishes it.
      const delay = preview ? [0, filtered.previewSecs?.again ?? 0, filtered.previewSecs?.hard ?? 0, filtered.previewSecs?.good ?? 0, 0][rating] : 0;
      const previewAgainAt = delay > 0 ? new Date(when.getTime() + delay * 1000) : undefined;
      const res = preview ? { sched: cur.sched, log: previewLog(cur, rating, when) } : review(cur.sched, rating, when, params, answerContext(cur, when, params));
      // A forgotten review can make the card a leech: its note is tagged, and the card suspended if the preset says so, as in Anki.
      const leech = params?.leech ?? DEFAULT_LEECH;
      const isLeech = !preview && becameLeech(cur.sched, res.sched, leech);
      const updated: Card = {
        ...cur, sched: res.sched, buriedAt: undefined, suspended: cur.suspended || (isLeech && leech.suspend),
        // Out of a filtered deck once it's a review (or a finished preview), as in Anki; still learning, it stays.
        // Its place in that deck (`filteredDue`) goes with it: left behind, the queue still reads the card as due whatever its due date.
        ...(!previewAgainAt && (preview || res.sched.state === 2) ? { filteredDeck: undefined, filteredDue: undefined } : {}),
        previewDue: previewAgainAt?.toISOString(),
        // Write-back stamps the Anki card's mod, which seeds Anki's review order.
        ankiMod: cur.ankiId ? Math.floor(when.getTime() / 1000) : cur.ankiMod,
      };
      // The note's other cards that its preset holds back until tomorrow, as Anki does.
      const siblings = preview ? [] : siblingsToBury(cur, pool, params?.bury, when, H);
      const buried = siblings.map((s): Card => ({ ...s, buriedAt: when.toISOString(), ankiMod: s.ankiId ? Math.floor(when.getTime() / 1000) : s.ankiMod }));
      // Counted in the deck the card is studied in, as Anki counts it (a filtered deck's answers count there).
      // Time capped at the preset's maximum answer time, as Anki caps it, so a phone put down mid-card doesn't swell the summary.
      // `reviewId` and `anki` are filled in by the write below; undo waits for it (`reviewWrites.idle()`).
      const takenMs = redo ? redo.takenMs : answerTimeMs(when.getTime() - shownAt.current, params);
      const record: AnswerRecord = {
        before: cur, deck: cardDeck(cur, nt.deck), buried: siblings,
        rating, takenMs, preview, counts: answerCounts(cur, when, H, !!preview, isSkillNote(nt)), ...(keptMiss ? { miss: keptMiss } : {}),
      };
      const stepCounts = { learn: (params?.learnSteps ?? DEFAULT_LEARN_STEPS).length, relearn: (params?.relearnSteps ?? DEFAULT_RELEARN_STEPS).length };
      const desiredRetention = params?.desiredRetention;
      const interday = !preview && isInterdayLearning(cur, H);
      const noteBefore = nt;

      // The next card shows now. The answer is written behind it, in order (below), so the screen
      // doesn't wait on the database. If a write fails, the answer is taken off the screen again.
      // Now a review, it weighs on the days the load balancer spreads later answers over, as in Anki.
      if (updated.sched.state === 2) recordAnswer(loadSnapshot.current, updated, params?.presetId, updated.sched.scheduledDays);
      // As a reload (`studiedToday`) counts it: a preview or an early review uses none.
      setStudied((s) => bumpStudied(s, record.deck, record.counts, 1));
      setHistory((h) => [...h, record]);
      misses.answered(cur.id, keptMiss);
      if (rating === 1 && miss === CONFUSED_REASON && canLinkConfused(nt)) sheets.request(confusedSheetFor(nt.id));
      // Reads the hook typed for this card, so it's called before the next card clears it.
      if (!redo) void ownHook.answered(nt);
      forms.answered({ cardId: cur.id, ...res.log });
      // Functional update: `cards` from this render's closure is stale once the awaits return.
      const changed = new Map([updated, ...buried].map((c) => [c.id, c]));
      setCards((prev) => prev && prev.map((c) => changed.get(c.id) ?? c));
      lastAnswered.current = cur;
      // The last answer stays on the line above the buttons until the next one, to undo or change. A
      // redo's card isn't the one `intervals` is for, so its buttons' intervals are worked out here.
      holdOffer.show(null);
      if (redo) stopSuggestion.withdraw(nt.id);
      else if (!preview) stopSuggestion.answered(cur, nt, rating, when);
      missCover.show(missMnemonic(nt, rating, !!preview) ?? null);
      lastAnswer.show(preview ? null : { cardId: cur.id, rating, interval: (redo ? previewIntervals(cur.sched, when, params, answerContext(cur, when)) : intervals)?.[rating], word: headword(nt) });
      // The next card goes up now, from the queue as it was, and the queue is rebuilt once it's on
      // screen (`settling`). Not while the last answer is still settling (that queue still has its
      // card), nor for a Change to Good or Again's `redo` (its queue is from before the undo).
      const buriedIds = new Set(siblings.map((sb) => sb.id));
      const heldAfter = forms.holdsAfter({ cardId: cur.id, ...res.log }, when, [updated, ...buried]);
      const next = !redo && queue && cards && !settle ? upNext(queue, cur, (cd) => buriedIds.has(cd.id) || heldAfter(cd)) : undefined;
      // A marked card whose return is due comes up before the queue's next card (the queue is rebuilt as usual).
      const comesBack = !redo && !preview ? cram.answered(cur.id, rating, !next, usableAfter(new Map([updated, ...buried].map((cd) => [cd.id, cd])), pool)) : undefined;
      setSettling(next && !comesBack && queue && cards ? { at: history.length + 1, next, queue, cards, now } : null);
      setPreferId(next?.id);
      setRevealedAt(undefined);
      setNow(when);

      writes.current++;
      const failuresBefore = failedWrites.current;
      void reviewWrites.add(async () => {
        // An answer queued behind one whose write failed was worked out from cards as that answer
        // left them (the same card again, a sibling it buried), and that answer is being taken back.
        // Writing this one would stack it on a state that was never saved, so it's taken back too.
        if (failedWrites.current !== failuresBefore) {
          setHistory((h) => h.filter((r) => r !== record));
          setReloads((n) => n + 1);
          if (toldDropped.current !== failedWrites.current) {
            toldDropped.current = failedWrites.current;
            Alert.alert("The answers after it weren't saved either", 'Those cards will come back too: answer them again.');
          }
          writes.current++;
          return;
        }
        // Started once the next card is on screen: its database round trips share the JS thread with drawing it.
        await painted();
        // A sync or an import that holds the kept collection while this is written reads it back over
        // the cards saved here: noted so they're saved again once the collection has the answer.
        const lockAtStart = repo.ankiLockState();
        const ankiAnswer = {
          before: record.before, after: updated, rating, now: when,
          takenMs, desiredRetention, bury: siblings,
          preview: preview ? { again: previewAgainAt } : undefined,
          steps: stepCounts,
          weights: params?.weights ?? [],
        };
        let owedId: number | undefined;
        try {
          await repo.saveCard(updated);
          for (const b of buried) await repo.saveCard(b);
          // Kept as owed to the Anki collection before the review row is, so an app closed while the
          // collection is busy (a sync stuck on the network) still has it to write at the next launch.
          if (record.before.ankiId) owedId = await repo.oweAnkiAnswer({ answer: ankiAnswer, buried });
          // Whether it was a day-long step goes in the row, so today's counts read it back after a reload.
          // So does the deck it was answered in (a filtered deck sends a card home; a card can be
          // moved since): today's counts keep it there, as Anki's deck counter counts it.
          record.reviewId = await repo.addReview({
            cardId: record.before.id, ...res.log, interday,
            ...(keptMiss ? { miss: keptMiss } : {}),
            deck: record.deck,
          });
        } catch (e) {
          // The card may have been saved before its review row failed: put it and the siblings it
          // buried back as they were, or it would stay rescheduled with no answer on record and
          // "answer it again" would be false. Best effort, since the database just refused a write.
          try {
            await repo.saveCard(record.before);
            for (const s of siblings) await repo.saveCard(s);
            if (owedId !== undefined) await repo.forgetOwedAnkiAnswer(owedId);
          } catch {
            // Left as it is; the reload below shows what was saved.
          }
          // Taken off the screen, and the deck is read again so what's shown is what was saved.
          failedWrites.current++;
          setHistory((h) => h.filter((r) => r !== record));
          lastAnswer.show(null);
          setReloads((n) => n + 1);
          Alert.alert("Couldn't save this answer", failureText(e, { next: 'The card will come back: answer it again.' }));
          writes.current++;
          return;
        }
        // The rest waits for the kept collection, in a queue of its own (`ankiWrites`): a sync holds
        // the collection while it talks to the server, and the next answers' rows above mustn't
        // wait behind that. Queued from inside this job, so the two halves keep the answers' order.
        void ankiWrites.add(async () => {
          // Into the kept Anki collection too, so "Send to Anki" carries this answer. If that write
          // fails, the answer still counts here, and you're told rather than it going missing.
          try {
            record.anki = await repo.writeAnkiAnswer({ ...ankiAnswer, owedId });
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
            // Not tried again at the next launch: it was refused, not left waiting.
            if (owedId !== undefined) await repo.forgetOwedAnkiAnswer(owedId).catch(() => undefined);
            if (!warnedAnki.current) {
              warnedAnki.current = true;
              Alert.alert(
                "Couldn't save this answer for Anki",
                failureText(e, { next: NOT_IN_ANKI }),
              );
            }
          }
          timing.saved(timed);
          if (isLeech && !noteBefore.tags.includes('leech')) {
            try {
              const tagged = await saveNote(repo as NoteStore, { id: noteBefore.id, deck: noteBefore.deck, model: noteBefore.model, fields: noteBefore.fields, tags: [...noteBefore.tags, 'leech'] }, when);
              record.leechNoteId = noteBefore.id;
              setNotes((prev) => new Map(prev).set(tagged.id, tagged));
            } catch {
              // The answer stands; the tag just isn't added.
            }
          }
          // The fourth miss asks for a mnemonic too, well before the leech threshold, and tags nothing (`asksEarlyHint`).
          if ((isLeech && canAddMnemonic(noteBefore)) || (!preview && asksEarlyHint(noteBefore, cur.sched, res.sched, leech.threshold))) {
            setPendingHints((list) => addPendingHint(list, { noteId: noteBefore.id, cardId: record.before.id, misses: res.sched.lapses, ...(updated.suspended && !record.before.suspended ? { suspendedCardId: record.before.id } : {}) }));
          }
        }).finally(() => { writes.current++; });
      });
    } finally {
      if (!redo) busy.current = false;
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

  /**
   * Takes the last answer back. With `to`, the same card is then answered that rating in this same
   * step (Change to Good, Change to Again), so the card never comes back to the screen between the two.
   */
  const undo = async (to?: RatingValue): Promise<boolean> => {
    const last = history[history.length - 1];
    // `undone`: a second tap landing before the screen has drawn the first undo still sees its
    // record as the last, and would take that card back again while the newer list lost another.
    if (!last || busy.current || undone.current.has(last)) return false;
    busy.current = true;
    cram.clearShowing();
    writes.current++;
    buttonHaptic(to);
    try {
      // The answer's own writes finish first: they give the review row and the Anki write to take back.
      await reviewWrites.idle();
      if (last.reviewId === undefined) return false; // its write failed, and said so
      // Out of the Anki collection first: a synced answer is in the server's history, and taking
      // it back here alone would leave the two disagreeing. As in Anki, undo stops at the last sync.
      if (last.anki && !(await repo.undoAnkiAnswer(last.anki))) {
        setHistory([]);
        setActions([]);
        lastAnswer.show(null);
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
      skill.undone(String(last.before.id));
      stopSuggestion.withdraw(last.before.noteId);
      setPendingHints((list) => removePendingHintForCard(list, last.before.id));
      forgetCard(loadSnapshot.current, last.before.id);
      undone.current.add(last);
      setHistory((h) => h.filter((r) => r !== last));
      forms.undone(last.before.id);
      setStudied((s) => bumpStudied(s, last.deck, last.counts, -1));
      const restored = new Map([last.before, ...last.buried].map((c) => [c.id, c]));
      setCards((prev) => prev && prev.map((c) => restored.get(c.id) ?? c));
      // The card shown again is the very one answered: it can be answered again now.
      lastAnswered.current = null;
      lastAnswer.show(null);
      const noteOf = n ?? notes.get(last.before.noteId);
      if (to && noteOf) {
        await answer(to, isSenseMiss(last.miss) ? last.miss : undefined, { card: last.before, note: noteOf, cards: (cards ?? []).map((c) => restored.get(c.id) ?? c), takenMs: last.takenMs });
        lastAnswer.announce(to === 3 ? 'good' : 'again');
        return true;
      }
      lastAnswer.announce('undone');
      setPreferId(last.before.id);
      setRevealedAt(undefined);
      setNow(new Date());
      return true;
    } catch (e) {
      Alert.alert("Couldn't undo that answer", failureText(e, { next: 'Try again.' }));
      return false;
    } finally {
      busy.current = false;
      writes.current++;
    }
  };

  // Change to Good or Again: take the last answer back and answer the same card again, in one step.
  const changeLast = async (to: RatingValue) => {
    const o = lastAnswer.last;
    const last = history[history.length - 1];
    if (!o || !last || last.before.id !== o.cardId) { lastAnswer.show(null); return; }
    await undo(to);
  };

  // A session that runs past the day's start counts the new day's answers from nothing, with the
  // load balancer's days read afresh: the cards are loaded again once the clock crosses it.
  useEffect(() => {
    if (loadedDay.current && studyDayKey(now, H) !== loadedDay.current) setReloads((n) => n + 1);
  }, [now, H]);
  // The clock is read again when the day starts with the screen open (nothing left to answer, say)
  // or the app comes back after it, so "All done" left overnight finds the new day's cards.
  const today = useStudyDay(H);
  useEffect(() => {
    if (loadedDay.current && today !== loadedDay.current) setNow(new Date());
  }, [today]);

  // Out of cards with a learning card still to come: wake when it's within the learn-ahead limit
  // instead of declaring the deck done, which left it waiting until the deck was reopened.
  // Not while vacation mode is paused: the queue offers nothing then, so the card would never come.
  const waitingFor = !current && cards && !vacationPlan(vacation, now, H)?.paused
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
  const sheet = sheets.head;
  const sheetNote = sheet && sheet.kind !== 'ask' ? notes.get(sheet.noteId) : undefined;
  const question = sheetNote ? mnemonicQuestion(sheetNote) : undefined;
  // The one sheet to show, in the same place whichever way the screen is drawn below, so finishing the deck doesn't remount it.
  let sheetHost: React.ReactNode = null;
  if (sheet?.kind === 'leech' && sheetNote) {
    sheetHost = (
      <LeechHintSheet
        key={sheet.key}
        visible={sheets.visible}
        onDismiss={() => sheets.dismissed(sheet.key)}
        word={htmlToText(sheetNote.fields.Entry ?? '')}
        translit={htmlToText(sheetNote.fields.Transliteration ?? '') || undefined}
        gloss={htmlToText(sheetNote.fields.Meaning ?? '') || undefined}
        misses={sheet.misses}
        suspended={!!sheet.suspendedCardId}
        step={sheet.step}
        suggest={suggestHints && question ? () => suggestHints(question) : undefined}
        onSkip={() => { setPendingHints((list) => removePendingHint(list, sheet.noteId)); sheets.close(sheet.key); }}
        onSkipRest={() => {
          // The ones still waiting are dropped from the queue, then this one is closed.
          for (const p of pendingHints) sheets.close(`leech:${p.noteId}`);
          setPendingHints([]);
        }}
        onSave={async (hint) => {
          // The card as it is now, captured before the awaits: still suspended, or nothing to bring back.
          const suspended = cards?.find((c) => c.id === sheet.suspendedCardId && c.suspended);
          const when = new Date();
          writes.current++;
          let result: Awaited<ReturnType<typeof saveLeechHint>>;
          try {
            result = await saveLeechHint(repo as NoteStore & AnkiLink, sheetNote, hint, suspended, when, H);
          } finally {
            writes.current++;
          }
          const { note: saved, card, cardError, ankiError } = result;
          setNotes((prev) => new Map(prev).set(saved.id, saved));
          if (card) {
            setCards((prev) => prev && prev.map((c) => (c.id === card.id ? card : c)));
            setNow(when);
          }
          setPendingHints((list) => removePendingHint(list, sheet.noteId));
          sheets.close(sheet.key);
          if (cardError) {
            Alert.alert("Couldn't unsuspend this card", failureText(cardError, { next: 'Your mnemonic is saved. To study the card again, unsuspend it when you edit its note.' }));
          } else if (ankiError) {
            Alert.alert("Couldn't save this change for Anki", failureText(ankiError, { next: NOT_IN_ANKI }));
          }
        }}
      />
    );
  } else if (sheet?.kind === 'confused' && sheetNote && cards) {
    sheetHost = (
      <ConfusedLinkSheet
        key={sheet.key}
        visible={sheets.visible}
        onDismiss={() => sheets.dismissed(sheet.key)}
        note={sheetNote}
        notes={notes}
        cards={cards}
        pairs={confused.pairs}
        onLink={(partnerId) => confused.link(sheetNote.id, partnerId)}
        onUnlink={(partnerId) => confused.unlink(sheetNote.id, partnerId)}
        onClose={() => sheets.close(sheet.key)}
      />
    );
  } else if (sheet?.kind === 'agentFlag' && sheetNote) {
    // The card and note this sheet was raised for, read again at each write: the screen may have moved on.
    const flagged = cards?.find((c) => c.id === sheet.cardId);
    // Writes the note (when it changes) and then the card's purple flag; the sheet closes itself once this returns.
    const writeFlag = async (flag: number, edit?: { tags: string[]; fields?: Record<string, string> }) => {
      const target = cards?.find((c) => c.id === sheet.cardId);
      if (!target) throw new Refusal("This card isn't loaded anymore. Close this and open it again.");
      if (busy.current) throw new Refusal('Another change is still saving. Try again in a moment.');
      if (edit) {
        writes.current++;
        try {
          const saved = await saveNote(repo as NoteStore, { id: sheetNote.id, deck: sheetNote.deck, model: sheetNote.model, fields: edit.fields ?? sheetNote.fields, tags: edit.tags });
          setNotes((prev) => new Map(prev).set(saved.id, saved));
        } finally {
          writes.current++;
        }
      }
      await setStates([target], (s) => ({ ...s, flag }));
    };
    sheetHost = (
      <AgentFlagSheet
        key={sheet.key}
        visible={sheets.visible}
        onDismiss={() => sheets.dismissed(sheet.key)}
        word={notePreview(sheetNote).front}
        reason={flagged?.flag === AGENT_FLAG ? flagReasonOf(sheetNote.tags) : null}
        note={flagged?.flag === AGENT_FLAG ? flagNoteOf(sheetNote.tags) : ''}
        onSave={(reason, text) => writeFlag(AGENT_FLAG, { tags: withFlagReason(sheetNote.tags, reason, text) })}
        onRemove={flagged?.flag === AGENT_FLAG ? () => writeFlag(0) : undefined}
        fix={fixFlaggedCard ? async (reason, text, thread) => checkFix(sheetNote, await fixFlaggedCard(fixRequest(sheetNote, reason, text, thread))) : undefined}
        onApply={(proposal) => writeFlag(0, { tags: withoutFlag(sheetNote.tags), fields: withFix(sheetNote.fields, proposal) })}
        onClose={() => sheets.close(sheet.key)}
      />
    );
  } else if (sheet?.kind === 'ask') {
    // Read from the note each render, so a change applied in the chat shows in the next question, not the card as the sheet opened.
    const askCard = (note && current ? cardForClaude(note, noteTypes.get(note.model), current.kind) : undefined) ?? sheet.card;
    sheetHost = (
      <AskCardSheet
        key={sheet.key}
        visible={sheets.visible}
        onDismiss={() => sheets.dismissed(sheet.key)}
        card={askCard}
        ask={askAboutCard ? (turns) => askAboutCard(askCard, turns) : undefined}
        // Added to the note's Notes field, as an edit made in the note editor would be.
        onSaveAnswer={note && isOmnilanguage(note) ? async (answer) => {
          writes.current++;
          try {
            const saved = await saveNote(repo as NoteStore, { id: note.id, deck: note.deck, model: note.model, fields: withNotesAnswer(note.fields, answer), tags: note.tags });
            setNotes((prev) => new Map(prev).set(saved.id, saved));
          } finally {
            writes.current++;
          }
        } : undefined}
        // Asked from the chat: the server suggests new field values, and nothing is saved until Apply.
        fix={askAboutCard && fixFlaggedCard && note ? async (turns) => checkFix(note, await fixFlaggedCard(chatFixRequest(note, turns))) : undefined}
        onApplyFix={note ? async (proposal) => {
          writes.current++;
          try {
            const saved = await saveNote(repo as NoteStore, { id: note.id, deck: note.deck, model: note.model, fields: withFix(note.fields, proposal), tags: note.tags });
            setNotes((prev) => new Map(prev).set(saved.id, saved));
          } finally {
            writes.current++;
          }
        } : undefined}
        onClose={() => sheets.close(sheet.key)}
      />
    );
  }
  // A sheet whose note is gone (or whose cards aren't loaded) can't show, and mustn't hold up the ones behind it.
  useEffect(() => {
    if (sheet && !sheetHost) { sheets.close(sheet.key); sheets.dismissed(sheet.key); }
  }, [sheet, sheetHost]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cards) return <Screen title={title} largeTitle={false}><Loading error={loadError} onRetry={() => setReloads((n) => n + 1)} /></Screen>;

  // Undo takes back the latest thing done, an answer or a menu action, as Anki's does.
  const undoNext = nextUndo(history.length, actions);
  const undoButton = undoNext
    ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel={undoNext === 'action' ? `Undo: ${actions[actions.length - 1].label}` : 'Undo the last answer'} onPress={() => (undoNext === 'action' ? undoAction() : undo())} />
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
    const mixing = sessionMisses.practice.length;
    // What can be done with the session just finished: rows in the list, so the footer stays two buttons.
    const steps: NextStep[] = [
      ...(pendingHints.length ? [{
        key: 'hints', label: 'Write mnemonics for cards you keep missing', detail: pendingHints.length === 1 ? '1 card' : `${pendingHints.length} cards`, icon: { name: 'lightbulb' as const, color: c.accent },
        onPress: () => pendingHints.forEach((p, i) => sheets.request({ key: `leech:${p.noteId}`, kind: 'leech', noteId: p.noteId, misses: p.misses, ...(p.suspendedCardId ? { suspendedCardId: p.suspendedCardId } : {}), step: { n: i + 1, of: pendingHints.length } })),
      }] : []),
      ...sessionMisses.practice.map((p) => ({
        key: p.key, label: p.label, icon: { name: p.request.tool === 'hearing' ? 'ear' as const : 'shuffle' as const, color: c.violet }, onPress: () => onPracticeMisses?.(p.request),
      })),
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
      ...(newWordsStep ? [newWordsStep] : []),
      ...(onSkillCards && !paramsForDeck(deck, allParams)?.filtered ? (() => {
        const language = skillOffer(deck, notes.values());
        return language ? [{ key: 'skills', label: `Add skill cards for ${language}`, icon: { name: 'square.stack.3d.up' as const, color: c.teal }, onPress: onSkillCards }] : [];
      })() : []),
      // An Anki filtered deck has no limits or notes of its own to browse or add to.
      ...(paramsForDeck(deck, allParams)?.filtered ? [] : [{ key: 'browse', label: 'Browse cards', icon: { name: 'magnifyingglass' as const, color: c.violet }, onPress: onBrowse }]),
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
      {sheetHost}
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
          {heldToday && !waitingFor ? (
            <Reveal rise={8} delay={500}>
              <Text style={{ ...type.subhead, color: c.textSecondary, textAlign: 'center' }}>
                {`${heldToday} ${heldToday === 1 ? 'review waits' : 'reviews wait'} until tomorrow, apart from a lookalike you saw today.`}
              </Text>
            </Reveal>
          ) : null}
          {history.length ? <Reveal rise={8} delay={560} style={{ alignSelf: 'stretch' }}><SessionSummary history={history} delay={560} /></Reveal> : null}
          {sessionMisses.rows.length || steps.length || extraCard ? (
            <Reveal rise={8} delay={760} style={{ alignSelf: 'stretch', gap: space.s }}>
              <SessionMissList
                rows={sessionMisses.rows}
                onOpen={(noteId) => onEditNote({ noteId }, (result) => {
                  if (!result) return;
                  // As the toolbar's edit button: a deleted note's cards are gone, so an answer to one can't be undone.
                  if ('deleted' in result) { setHistory([]); setActions([]); lastAnswer.show(null); }
                  setReloads((n) => n + 1);
                })}
              />
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
    timing.revealPressed();
    Keyboard.dismiss();
    // A take made from memory ends here, quietly, so the answer's own recording plays.
    self.stop(false);
    setRevealedAt(showing);
    if (rendered) speak(autoplayFor(rendered, true));
  };
  // Type it and the learner's own hook (activeRecall.ts), for a native Omnilanguage card.
  const typeItWord = rendered ? typeItAnswer(note, current) : undefined;
  // The footer's one microphone: Answer by speaking where the card asks for a typed word and iOS can hear the language
  // (which also keeps the take, `keepTake` above), else Record yourself on a card with a recording to compare against.
  const footerMic = typeItWord && spoken.available
    ? <SpeakButton spoken={spoken} />
    : rendered && canRecordYourself(rendered) ? <RecordMicButton rec={self} label="Record" /> : null;
  const asksHook = !!rendered && ownHook.on && asksOwnHook(note, current, noteCards(current, cards));
  // Under the answer: what was typed against the word, the offer to show the card sooner, the suggestion to practice its forms, and the hook.
  const extras = revealed ? (
    <>
      {typing && typeItWord ? <TypedDiff comparison={compareTypedAnswer(typeItAnswers(note, current), typed, rendered?.speechLang)} showExpected={false} lang={rendered?.speechLang} typedLabel={spokenIn ? 'You said' : 'Yours'} /> : null}
      {typing && typeItWord && spokenIn ? <Text style={{ ...type.footnote, color: c.textSecondary }}>{spokenAnswerNote(rendered?.speechLang)}</Text> : null}
      <AnswerExtras
        word={headword(note)}
        offer={forms.offerView(goodFrom)}
        onSooner={forms.setSooner}
        suggestion={forms.suggestion}
        onPractice={() => onPracticeForms(forms.drillFor(note.id, note.deck))}
        onLater={() => forms.putOff(note.id)}
      />
      <ConfusedRow note={note} partners={confused.partners} notes={notes} onPress={() => sheets.request(confusedSheetFor(note.id))} />
      {asksHook ? <OwnHookField value={ownHook.text} onChange={ownHook.setText} onFocusChange={setHookFocused} /> : null}
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

  // A word typed wrong (Type it, or a template card's type-in box) is a miss, whatever it felt like (`typedMiss`); a
  // spoken one only when it was nothing like the word (`spokenMiss`), since the recognizer mishears.
  const typedWrong = revealed && !!typed.trim() && (
    typing && typeItWord ? (spokenIn ? spokenMiss : typedMiss)(compareTypedAnswer(typeItAnswers(note, current), typed, rendered?.speechLang))
      : typeInExpected && !spokenIn ? typedMiss(compareTyped(stripExpected(typeInExpected), typed)) : false);
  // With a sense marked as missed, or the word typed wrong, Again is outlined as the rating that fits; the tap still decides.
  const suggested = suggestedRating ?? (senseMarks.miss || typedWrong ? 1 : undefined);
  const footer = revealed && returned ? (
    <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
      {([{ r: 1, label: 'Missed it', color: c.again }, { r: 3, label: 'Got it', color: c.good }] as const).map((b) => (
        <Tappable
          key={b.r}
          onPress={() => rate(b.r)}
          accessibilityRole="button"
          accessibilityLabel={`${b.label}. Extra pass, nothing is scheduled`}
          scaleTo={0.95}
          dimTo={0.85}
          style={{ flex: 1, minHeight: FOOTER_BUTTON_HEIGHT, borderRadius: radius.m + 2, ...smooth, paddingVertical: space.s, alignItems: 'center', justifyContent: 'center', backgroundColor: b.color }}
        >
          <Text style={{ ...type.headline, color: c.onRating }}>{b.label}</Text>
        </Tappable>
      ))}
    </Reveal>
  ) : revealed ? (
    <>
    <AspectResult check={aspectCheck} />
    <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
      {drill ? <SkillBackButton skill={skill} onBack={() => setRevealedAt(undefined)} /> : null}
      {buttons.map((b) => b.r === 1 && missReasons.length && !senseMarks.miss ? (
        <AgainSplit key={b.r} interval={intervals?.[1]} reasons={missReasons} suggested={suggested === 1} onAnswer={(miss) => rate(1, miss)} />
      ) : (
        <Tappable
          key={b.r}
          onPress={() => rate(b.r)}
          accessibilityRole="button"
          accessibilityLabel={`${b.label}, next in ${intervals?.[b.r] ?? ''}${suggested === b.r ? ', suggested' : ''}`}
          scaleTo={0.95}
          dimTo={0.85}
          // After a skill card's drill, the rating it suggests is outlined and the others quieter; the tap is still the learner's.
          restOpacity={suggestedRating && suggestedRating !== b.r ? 0.55 : 1}
          style={{
            flex: 1, minHeight: FOOTER_BUTTON_HEIGHT, borderRadius: radius.m + 2, ...smooth, paddingVertical: space.s,
            alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: b.color,
            // The border is always there, transparent unless suggested, so outlining a button doesn't change its size.
            borderWidth: 3, borderColor: suggested === b.r ? c.text : 'transparent',
          }}
        >
          {/* The interval sits above the label, as in Anki, so the eye lands on when it's next due. */}
          <Text style={{ ...type.footnote, color: b.on ?? c.onRating, fontVariant: ['tabular-nums'] }}>{intervals?.[b.r]}</Text>
          <Text style={{ ...type.headline, color: b.on ?? c.onRating }}>{b.label}</Text>
        </Tappable>
      ))}
    </Reveal>
    </>
  ) : drill && skill.question ? (
    <SkillDrillFooter skill={skill} onFinished={reveal} say={(text, speech) => phoneSpeech.sayWord(text, speech)} />
  ) : (
    <>
      {typing ? null : <AspectQuestion check={aspectCheck} />}
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
      {page?.typeAnswer || (typing && typeItWord) ? <MissingKeyboardNote speechTag={typedTag} /> : null}
      {typeItWord ? <ListeningNote spoken={spoken} language={rendered?.speechLang ? languageName(rendered.speechLang.split('-')[0]) : 'the word'} /> : null}
      {typeItWord && !typing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <TypeItButton onPress={() => setTyping(true)} />
          {footerMic}
          <Button label="Show answer" onPress={reveal} style={{ flex: 1, minHeight: FOOTER_BUTTON_HEIGHT }} />
        </View>
      ) : typeItWord ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          {footerMic}
          <Button label="Check" onPress={() => { spoken.cancel(); reveal(); }} style={{ flex: 1, minHeight: FOOTER_BUTTON_HEIGHT }} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          {footerMic}
          <Button label={typing ? 'Check' : 'Show answer'} onPress={reveal} style={{ flex: 1, minHeight: FOOTER_BUTTON_HEIGHT }} />
        </View>
      )}
    </>
  );

  // Suspend, bury or flag cards from the menu: in Franki first, then in the kept collection, as Anki writes it.
  // `label` says what was done, which puts it in Undo (`actions`); `strip` also floats Undo over the next
  // card for a few seconds (HoldUndo.tsx), for a change that takes the card off screen.
  const setStates = async (targets: Card[], change: (s: CardState) => CardState, label?: string, strip = false) => {
    if (busy.current || !targets.length) return;
    busy.current = true;
    writes.current++;
    try {
      // An answer still being written saves its card again once it has the Anki lock, which would put
      // back the state this changes: it finishes first.
      await reviewWrites.idle();
      const when = new Date();
      const { cards: updated, anki, ankiError } = await setCardStatesUndoable(repo as NoteStore, targets, change, when, H);
      if (ankiError) {
        Alert.alert("Couldn't save this change for Anki", failureText(ankiError, { next: NOT_IN_ANKI }));
      }
      const byId = new Map(updated.map((u) => [u.id, u]));
      setCards((prev) => prev && prev.map((c) => byId.get(c.id) ?? c));
      setRevealedAt(undefined);
      setNow(when);
      haptic.success();
      if (label) addAction({ kind: 'state', label, before: targets, anki }, strip);
    } catch (e) {
      Alert.alert("Couldn't change this card", failureText(e, { next: 'Try again.' }));
    } finally {
      busy.current = false;
      writes.current++;
    }
  };
  // A menu action joins Undo. The last answer's line goes, so its Undo can't take back an answer from
  // under a later action: Undo always takes back the latest thing first.
  const addAction = (a: Omit<CardAction, 'afterAnswers'>, strip: boolean) => {
    setActions((list) => [...list, { ...a, afterAnswers: history.length }]);
    lastAnswer.show(null);
    holdOffer.show(strip ? { label: a.label } : null);
  };
  // Undo of the latest menu action: the cards go back as they were, in the kept collection too, and the
  // first comes back on screen. As in Anki, undo stops at the last sync.
  const undoAction = async () => {
    const last = actions[actions.length - 1];
    holdOffer.show(null);
    if (!last || busy.current) return;
    busy.current = true;
    writes.current++;
    haptic.select();
    try {
      await reviewWrites.idle(); // as in setStates above
      const when = new Date();
      const restored = await undoCardAction(repo as NoteStore, last, cards ?? [], when);
      if (!restored) {
        setActions([]);
        setHistory([]);
        Alert.alert("Couldn't undo this", 'It has already been synced to your Anki server. Undo only goes back to the last sync.');
        return;
      }
      setActions((list) => list.filter((x) => x !== last));
      const byId = new Map(restored.map((u) => [u.id, u]));
      setCards((prev) => prev && prev.map((c) => byId.get(c.id) ?? c));
      setPreferId(last.before[0].id);
      setRevealedAt(undefined);
      setNow(when);
    } catch (e) {
      Alert.alert("Couldn't undo this", failureText(e, { next: 'Try again.' }));
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
      setStates([current], (s) => ({ ...s, flag }), flagLabel(flag));
    });
  };
  // Flag for an agent (through the Franki MCP): the purple flag on the card, a flag::<reason> tag on the note and, when one is typed, a flagnote:: tag. AgentFlagSheet asks for them.
  const chooseAgentFlag = () => {
    if (!current || !note) return;
    sheets.request({ key: `agentFlag:${current.id}`, kind: 'agentFlag', noteId: note.id, cardId: current.id });
  };
  // Forget and Set Due Date: in the kept collection as Anki does them, then in Franki (rescheduleService.ts).
  const reschedule = async (run: (when: Date) => Promise<Rescheduled>, failure: string, label: string, before: Card[]) => {
    if (busy.current) return;
    busy.current = true;
    writes.current++;
    try {
      await reviewWrites.idle(); // as in setStates above
      const when = new Date();
      const { cards: updated, anki } = await run(when);
      const byId = new Map(updated.map((u) => [u.id, u]));
      setCards((prev) => prev && prev.map((c) => byId.get(c.id) ?? c));
      setRevealedAt(undefined);
      setNow(when);
      haptic.success();
      addAction({ kind: 'schedule', label, before, anki }, true);
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
      message: 'It goes back to being a new card, in its old place. Forget and reset counts also sets its review and lapse counts to zero.',
      options, cancelButtonIndex: 2, destructiveButtonIndex: 0,
    }, (i) => {
      if (i === 2) return;
      const target = current;
      reschedule((when) => forgetCards(repo as NoteStore, [target], { resetCounts: i === 1 }, when), "Couldn't forget this card", 'Forgot this card', [target]);
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
            reschedule((when) => setDueDates(repo as NoteStore, [target], spec, when), "Couldn't set the due date", dueDateLabel(spec), [target]);
          },
        },
      ],
      'plain-text', '', 'numbers-and-punctuation',
    );
  };
  return (
    <>
    {sheetHost}
    <View ref={header.ref} onLayout={header.onLayout} style={{ flex: 1, paddingTop: header.top, paddingBottom: fieldEdit.editing || hookFocused ? 0 : Math.max(0, keyboard - insets.bottom) }}>
    <Screen
      title={title}
      largeTitle={false}
      // The stack's swipe-back would take a rightward drag before the card's own swipe sees it.
      lockGesture={swipeOn && revealed && ((!page && !!rendered) || !!drill)}
      toolbar={
        <Stack.Toolbar placement="right">
          {current.flag ? (
            <Stack.Toolbar.Button icon="flag.fill" tintColor={c.flags[current.flag]} accessibilityLabel={`Flagged ${FLAG_NAMES[current.flag]}. Change the flag`} onPress={chooseFlag} />
          ) : null}
          {undoButton}
          <Stack.Toolbar.Button
            icon="square.and.pencil"
            accessibilityLabel="Edit this card's note"
            onPress={() => onEditNote({ noteId: note.id }, (result) => {
              if (!result) return;
              // A deleted note's cards are gone, so an answer to one can't be undone any more.
              if ('deleted' in result) { setHistory([]); setActions([]); lastAnswer.show(null); }
              else setPreferId(current.id);
              setReloads((n) => n + 1);
            })}
          />
          {reviewMenu({
            text: deckOwnsFont ? { ...cardText, code: undefined } : cardText,
            textSize: { value: textSize, onChange: chooseTextSize },
            flag: current.flag ?? 0,
            onMnemonic: canAddMnemonic(note) ? () => sheets.request({ key: `leech:${note.id}`, kind: 'leech', noteId: note.id }) : undefined,
            onLinkConfused: canLinkConfused(note) ? () => sheets.request(confusedSheetFor(note.id)) : undefined,
            cramOn: !!cram.entry(current.id),
            onCram: isSkillNote(note) ? undefined : () => { haptic.select(); cram.toggle(current.id, history.some((h) => h.before.id === current.id)); },
            onAskClaude: () => {
              const card = cardForClaude(note, noteTypes.get(note.model), current.kind);
              if (card) sheets.request({ key: 'ask', kind: 'ask', card });
              else Alert.alert("Can't ask about this card", 'This card has no text to ask about. Open its note to see the fields.');
            },
            onFlag: (flag) => setStates([current], (s) => ({ ...s, flag }), flagLabel(flag)),
            onAgentFlag: agentFlags ? chooseAgentFlag : undefined,
            onBuryCard: () => setStates([current], (s) => ({ ...s, buried: true }), 'Buried this card until tomorrow', true),
            onBuryNote: () => setStates(noteCards(current, cards ?? []), (s) => ({ ...s, buried: true }), 'Buried this note until tomorrow', true),
            onSuspend: () => setStates([current], (s) => ({ ...s, suspended: true }), 'Suspended this card', true),
            onSuspendNote: () => setStates(noteCards(current, cards ?? []), (s) => ({ ...s, suspended: true }), 'Suspended this note', true),
            onDueDate: chooseDueDate,
            onForget: chooseForget,
            // The deck is loaded again when Card Info closes: the same card stays on screen.
            onCardInfo: () => { setPreferId(current.id); onCardInfo(current.id); },
            onBrowse: paramsForDeck(deck, allParams)?.filtered ? undefined : onBrowse,
            timingOn: timing.on,
            onTiming: timing.toggle,
            onSettings,
          })}
        </Stack.Toolbar>
      }
      footer={<ReviewFooter>{lastAnswer.last || lastAnswer.notice ? <LastAnswerLine last={lastAnswer.last} notice={lastAnswer.notice} onUndo={() => undo()} onChange={changeLast} /> : null}{footer}</ReviewFooter>}
      floating={holdOffer.offer ? <HoldStrip offer={holdOffer.offer} onUndo={undoAction} /> : contrast.offer ? <HoldStrip offer={contrast.offer} onUndo={contrast.undo} /> : stopSuggestion.offer ? <SkillStopStrip offer={stopSuggestion.offer} onStop={() => void stopSuggestion.stop()} onDismiss={stopSuggestion.dismiss} /> : null}
    >
      {queue ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          <Count value={dueCounts(queue).reviews} label="due" color={c.countDue} current={shownCount === 'due'} />
          <Count value={dueCounts(queue).learning} label="again" color={c.countLearn} current={shownCount === 'again'} />
          <Count value={queue.fresh.length} label="new" color={c.countNew} current={shownCount === 'new'} />
          {cardParams?.showTimer ? <AnswerTimer key={showing} revealed={revealed} params={cardParams} /> : null}
        </View>
      ) : null}
      {queue ? <ProgressBar value={progressRef.current} style={{ marginHorizontal: space.l, marginTop: space.s }} /> : null}
      {timing.line ? <Text style={{ ...type.caption, color: c.textSecondary, textAlign: 'center', marginHorizontal: space.l, marginTop: space.s }}>{timing.line}</Text> : null}
      {drill && skill.question ? (
        <SwipeCard enabled={swipeOn && revealed} language={cardLanguage} cardKey={`${current.id}:${turn}`} shown={shown} motion={cardMotion} onRate={answer}>
          <SkillDrillCard skill={skill} revealed={revealed} say={(text, speech) => phoneSpeech.sayWord(text, speech)} />
        </SwipeCard>
      ) : null}
      {page && !drill ? <CardStateChips chip={stateChip(current, { learn: cardParams?.learnSteps ?? DEFAULT_LEARN_STEPS, relearn: cardParams?.relearnSteps ?? DEFAULT_RELEARN_STEPS })} leech={liveLeech} mnemonic={!revealed && hasMnemonic(note)} style={{ marginTop: space.m }} /> : null}
      {(page && !drill) || aheadPage ? (
        <SwipeCard enabled={false} offstage={!page || !!drill} language={cardLanguage} cardKey={`${current.id}:${turn}`} shown={shown} motion={page && !drill ? cardMotion : offstageMotion} onRate={answer}>
          {/* One WebView for both sides, so Show answer loads the back into it with the front still showing, rather than
              blanking the card while a new one starts. Keyed to the card and the answers given, so a card shown
              again (after Again, or an undo) starts fresh instead of showing its back while its front loads.
              The second, hidden, is keyed as the next card will be once this one is answered: when that card comes
              up, React keeps that WebView, already loaded, and shows it. While a native or drill card is on screen
              this card is offstage and holds only that second one, in the same place, so it's kept the same way. */}
          {[
            page && !drill ? <CardWebView key={`${current.id}:${turn}`} html={revealed ? page.back : page.front} onShown={timing.on ? () => timing.shown(`${current.id}:${turn}`) : undefined} onMessage={onPageMessage} onTap={revealed ? undefined : () => { haptic.select(); reveal(); }} onLookUp={pageLookUp.onLookUp} /> : null,
            ahead && aheadPage ? <CardWebView key={`${ahead.id}:${turn + 1}`} hidden html={aheadPage.front} onMessage={onPageMessage} onTap={() => { haptic.select(); reveal(); }} /> : null,
          ]}
          {pageLookUp.popover}
        </SwipeCard>
      ) : null}
      {page && extras && !drill ? (
        <ScrollView style={{ flexGrow: 0, maxHeight: '45%' }} contentContainerStyle={{ paddingHorizontal: space.l, paddingVertical: space.s }}>{extras}</ScrollView>
      ) : null}
      {page || drill ? null : rendered ? (
        <View style={{ flex: 1 }}>
        {/* Lays the back's faces out while the front shows, so the flip doesn't pay for loading them (src/core/faceWarmup.ts). */}
        {revealed ? null : <FaceWarmup font={cardFont} text={warmupText(rendered.back.blocks)} />}
        <SwipeCard enabled={swipeOn && revealed && !fieldEdit.editing} language={cardLanguage} cardKey={`${current.id}:${turn}`} shown={shown} motion={cardMotion} onRate={answer}>
          {/* Tapping the card shows the answer. Not an accessibility element itself: the card's text stays readable, and Show answer is the control VoiceOver uses. */}
          <Pressable accessible={false} disabled={revealed} onPress={() => { haptic.select(); reveal(); }} style={{ flex: 1 }}>
          <ScrollView {...cardScroll.scrollProps} scrollIndicatorInsets={playButtonScrollInsets(!!playbackFor(rendered, revealed))} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.xl, paddingTop: space.xxl + space.xl, paddingBottom: (playbackFor(rendered, revealed) ? PLAY_BUTTON_CLEARANCE : space.xl) + (fieldEdit.editing || hookFocused ? cardScroll.bottomPadding : 0), gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: READABLE_WIDTH, alignSelf: 'center' }}>
            {/* Keyed to the showing, so each card, and a card shown again, fades in rather than swapping. Quickly: until it's in, the next card reads as slow to arrive. */}
            <Reveal key={showing} rise={6} duration={140} style={{ gap: space.l }}>
              <CardStateChips chip={stateChip(current, { learn: cardParams?.learnSteps ?? DEFAULT_LEARN_STEPS, relearn: cardParams?.relearnSteps ?? DEFAULT_RELEARN_STEPS })} leech={liveLeech} mnemonic={!revealed && hasMnemonic(note)} />
              <CardFontScope font={cardFont} scale={textScale(textSize)}><Side key={current.id} side={rendered.front} which="front" showHints={showHints || revealed} thaiSize={thaiSize} speechLang={speechLang} speakSentence={speechLang ? speakSentence : undefined} {...(revealed ? { furigana, wordRuns } : {})} /></CardFontScope>
              <LanguageCue kind={current.kind} speechLang={speechLang} />
              {/* Record yourself's mic is in the footer; once a take is made or being made, its capsule takes a row here. */}
              {reminder ? <MissReminder text={reminder} /> : null}
              {senseCountOn && !senseMarks.reminder && !revealed && senseCountLabel(senseMarks.count) ? <SenseCount text={senseCountLabel(senseMarks.count)!} /> : null}
              {senseMarks.reminder && !revealed ? <SenseReminder key={current.id} {...senseMarks.reminder} /> : null}
              {canRecordYourself(rendered) && !idleRecording(self) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.s }}>
                  <RecordYourself rec={self} label="Record" size="card" />
                </View>
              ) : null}
              <ReviewPitchLine rec={self} recordingUri={recordingUri} speechLang={speechLang} note={note} />
            </Reveal>
            {revealed ? (
              <Reveal rise={14} style={{ gap: space.xl }}>
                {/* Not `border`: the card takes a tint while it's swiped, and `border` is too close to a dark tinted card to show. */}
                <View style={{ height: hairline, backgroundColor: c.textTertiary, opacity: 0.6 }} />
                <CardFontScope font={cardFont} scale={textScale(textSize)}><Side key={current.id} side={rendered.back} which="back" showHints={showHints} thaiSize={thaiSize} speechLang={speechLang} gloss={note ? glossFor(current, note) : null} speakSentence={speechLang ? speakSentence : undefined} furigana={furigana} wordRuns={wordRuns} onEditField={note ? (field, text) => fieldEdit.save(note.id, field, text) : undefined} onEditing={fieldEdit.setEditing} contrast={contrast.actions} senseMarking={senseMarks.marking} /></CardFontScope>
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
    {missCover.shown ? <MissMnemonicCover shown={missCover.shown} onContinue={() => { shownAt.current = Date.now(); missCover.hide(); }} /> : null}
    </View>
    </>
  );
}
