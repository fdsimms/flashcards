import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Stack } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Animated, Easing, Keyboard, PanResponder, Pressable, ScrollView, Text, TextInput, useColorScheme, useWindowDimensions, View } from 'react-native';
import { FLAG_NAMES, noteCards, type CardState } from '../core/cardState';
import { isOmnilanguage, renderCard } from '../core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../core/config';
import { cardDeck, cardHomeDeck, isInDeck, queueInput, treeQueue } from '../core/deckTree';
import { nextStudyDayStart, studyDayStart } from '../core/day';
import { nextLearningDue, siblingsToBury, studiedKind, studiedToday, type StudiedToday } from '../core/queue';
import { ratingsShown, type AnswerButtons } from '../core/answerButtons';
import { becameLeech, DEFAULT_LEARN_STEPS, DEFAULT_LEECH, DEFAULT_RELEARN_STEPS, paramsForDeck, previewIntervals, previewLog, review, type AnswerContext, type RatingValue } from '../core/scheduler';
import { fuzzSeed } from '../core/ankiFuzz';
import { balancerFor, buildLoadSnapshot, forgetCard, loadDayIndex, recordAnswer, type LoadSnapshot } from '../core/loadBalance';
import { ankiToday, fnvHash } from '../core/order';
import { saveNote, setCardStates, type NoteStore } from '../anki/noteService';
import { bumpStudied, currentCard, sessionProgress, sessionSummary, SWIPE_DISTANCE, swipeRating, type AnswerRecord } from '../core/session';
import { durationText } from '../core/stats';
import { cardDocument, renderTemplateCard, sideAudio } from '../core/template';
import { pickVoice, speechLanguage, type TtsTag } from '../core/tts';
import type { Card, CollectionSettings, DeckParams, DeckSettings, Note, NoteType, RenderedSide } from '../core/types';
import type { AnkiUndo } from '../anki/writeback';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { mediaBaseUri, mediaFileUri } from '../media/mediaFiles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardWebView } from './CardWebView';
import type { NoteEditorResult, NoteEditorTarget } from './AppContext';
import { practiceWords } from '../reader/practice';
import { headword, type DrillRequest } from '../core/forms';
import { AnswerExtras, FormsCheck, useReviewForms } from './ReviewForms';
import { haptic } from './haptics';
import { Button, Count, Icon, Screen, Tappable } from './kit';
import { Reveal, useReduceMotion } from './motion';
import { hairline, lift, MIN_TAP, radius, smooth, space, type, useTheme } from './theme';

/**
 * One side of a natively rendered card: the word or question large and centered, the details
 * under it in smaller text with their labels.
 */
function Side({ side, which }: { side: RenderedSide; which: 'front' | 'back' }) {
  const c = useTheme();
  return (
    <View style={{ gap: space.m }}>
      {side.blocks.map((b, i) => (
        <View key={i} style={{ gap: space.xs }}>
          {b.label ? (
            <Text style={{ ...type.overline, color: c.accent }}>{b.label}</Text>
          ) : null}
          <Text
            style={b.emphasis
              ? { ...(which === 'front' ? type.cardFront : type.cardBack), color: c.text, textAlign: 'center' }
              : { ...type.body, color: c.textSecondary, lineHeight: 24 }}
          >
            {b.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The card itself: a raised sheet that fills the space between the header and the buttons. */
function CardSurface({ children }: { children: React.ReactNode }) {
  const c = useTheme();
  return (
    <View
      style={{
        flex: 1, marginHorizontal: space.l, marginTop: space.s, marginBottom: space.xs, borderRadius: radius.xl, ...smooth,
        backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border, ...lift(c),
      }}
    >
      {/* Clipped inside the shadow's box: a view that clips can't also cast one. */}
      <View style={{ flex: 1, borderRadius: radius.xl, ...smooth, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

/** How far through the session is, as a thin line under the header. */
function ProgressBar({ value }: { value: number }) {
  const c = useTheme();
  const reduce = useReduceMotion();
  const v = useRef(new Animated.Value(value)).current;
  useEffect(() => {
    // Width can't use the native driver; the bar is one view, so the JS-driven animation is cheap.
    Animated.timing(v, { toValue: value, duration: reduce ? 0 : 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Progress through this session"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{ height: 4, marginHorizontal: space.l, marginTop: space.xs, borderRadius: 2, backgroundColor: c.fill, overflow: 'hidden' }}
    >
      <Animated.View style={{ height: 4, borderRadius: 2, backgroundColor: c.accent, width: v.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }) }} />
    </View>
  );
}

/**
 * The card sheet, draggable sideways once it's revealed when swiping is on: it follows the finger,
 * tints toward the answer it would give (right Good, left Again), and flies off when let go past
 * the line. Only a rating the answer buttons show can be given (`swipeRating`).
 */
function SwipeCard({ enabled, shown, onRate, children }: { enabled: boolean; shown: RatingValue[]; onRate: (r: RatingValue) => Promise<void>; children: React.ReactNode }) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const x = useRef(new Animated.Value(0)).current;
  // The responder is made once, so it reads the latest props from here.
  const latest = useRef({ enabled, shown, onRate, width });
  latest.current = { enabled, shown, onRate, width };
  const crossed = useRef(false);
  const back = () => Animated.spring(x, { toValue: 0, useNativeDriver: false, speed: 20, bounciness: 6 }).start();
  const responder = useRef(
    PanResponder.create({
      // Claim only a clearly horizontal drag, so the card's own text still scrolls vertically.
      onMoveShouldSetPanResponder: (_, g) => latest.current.enabled && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        x.setValue(g.dx);
        const past = swipeRating(g.dx, 0, latest.current.shown) !== null;
        if (past !== crossed.current) { crossed.current = past; if (past) haptic.select(); }
      },
      onPanResponderRelease: (_, g) => {
        crossed.current = false;
        const rating = swipeRating(g.dx, g.vx, latest.current.shown);
        if (!rating) { back(); return; }
        Animated.timing(x, { toValue: Math.sign(g.dx) * latest.current.width * 1.2, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(async () => {
          await latest.current.onRate(rating);
          x.setValue(0);
        });
      },
      onPanResponderTerminate: () => { crossed.current = false; back(); },
    }),
  ).current;
  const tint = (from: number, to: number) => x.interpolate({ inputRange: [from, to].sort((a, b) => a - b), outputRange: from < to ? [0, 0.22] : [0.22, 0], extrapolate: 'clamp' });
  return (
    <Animated.View
      {...responder.panHandlers}
      style={{ flex: 1, transform: [{ translateX: x }, { rotate: x.interpolate({ inputRange: [-300, 0, 300], outputRange: ['-5deg', '0deg', '5deg'], extrapolate: 'clamp' }) }] }}
    >
      <CardSurface>
        {children}
        {/* Tints and words that ramp in as the card is dragged: the answer it would give. */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.good, opacity: tint(0, SWIPE_DISTANCE) }} />
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.again, opacity: tint(0, -SWIPE_DISTANCE) }} />
        <Animated.Text pointerEvents="none" style={{ ...type.title, position: 'absolute', top: space.l, left: space.xl, color: c.good, opacity: tint(0, SWIPE_DISTANCE).interpolate({ inputRange: [0, 0.22], outputRange: [0, 1] }) }}>Good</Animated.Text>
        <Animated.Text pointerEvents="none" style={{ ...type.title, position: 'absolute', top: space.l, right: space.xl, color: c.again, opacity: tint(0, -SWIPE_DISTANCE).interpolate({ inputRange: [0, 0.22], outputRange: [0, 1] }) }}>Again</Animated.Text>
      </CardSurface>
    </Animated.View>
  );
}

/** What this session did, shown when the queue is empty: cards answered, time, and how many were Again. */
function SessionSummary({ history }: { history: AnswerRecord[] }) {
  const c = useTheme();
  const { answered, again, takenMs } = sessionSummary(history);
  const tile = (value: string, label: string) => (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ ...type.footnote, color: c.textSecondary }}>{label}</Text>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel={`This session: ${answered} ${answered === 1 ? 'card' : 'cards'}, ${durationText(takenMs)}, ${again} answered Again`}
      style={{ flexDirection: 'row', alignSelf: 'stretch', marginTop: space.xl, paddingVertical: space.l, borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderWidth: hairline, borderColor: c.border }}
    >
      {tile(String(answered), answered === 1 ? 'card' : 'cards')}
      {tile(durationText(takenMs), 'studying')}
      {tile(String(again), 'Again')}
    </View>
  );
}

/**
 * Studies `deck` and its subdecks. Each card is scheduled with its own deck's FSRS settings, and
 * every deck's daily limits apply (`treeQueue`). Omnilanguage cards render natively with TTS;
 * other note types render their Anki templates in a WebView.
 */
export function Review({ repo, deck, practice, onDone, onEditNote, onPracticeForms }: {
  repo: Repo & AnkiLink;
  deck: string;
  /**
   * Present when the deck is a Read & Listen language's (src/reader/practice.ts): once the session
   * ends, it offers a text that practices the words just studied.
   */
  practice?: { languageDeck: string; onRead: (words: string[]) => void };
  /** Leaves the screen: the deck is done. */
  onDone: () => void;
  /** Opens the note editor over this screen, calling `onClose` with what happened. */
  onEditNote: (target: NoteEditorTarget, onClose: (result?: NoteEditorResult) => void) => void;
  /** Opens a forms drill (src/ui/FormsDrill.tsx) over this screen. */
  onPracticeForms: (request: DrillRequest) => void;
}) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [cards, setCards] = useState<Card[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [studied, setStudied] = useState<Map<string, StudiedToday>>(new Map());
  const [allParams, setAllParams] = useState<Map<string, DeckParams>>(new Map());
  // The Anki collection's day start, learn-ahead limit and v3 options.
  const [collection, setCollection] = useState<CollectionSettings>(DEFAULT_COLLECTION_SETTINGS);
  const H = collection.dayStartsAtHour;
  const [answerButtons, setAnswerButtons] = useState<AnswerButtons>('all');
  const [swipeOn, setSwipeOn] = useState(false);
  // Bumped after the note editor saves or deletes, to load the cards and notes again.
  const [reloads, setReloads] = useState(0);
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [deckSettings, setDeckSettings] = useState<Map<string, DeckSettings>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [preferId, setPreferId] = useState<string>();
  // Set while an answer or an undo is being written. A second tap during the await would
  // otherwise act on the same card again from its old state.
  const busy = useRef(false);
  // Anki's load balancer works from a snapshot of the days ahead, taken when the session is built.
  const loadSnapshot = useRef<LoadSnapshot>(new Map());

  useEffect(() => {
    (async () => {
      const now = new Date();
      const cs = await repo.collectionSettings();
      const dayStart = studyDayStart(now, cs.dayStartsAtHour);
      const [c, n, reviews, revlog, params, types, settings, buttons, swipe] = await Promise.all([
        // Every card, not only this deck's: a gate on a deck above this one counts its whole subtree.
        repo.listCards(), repo.listNotes(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
        repo.listDeckParams(), repo.listNoteTypes(), repo.listDeckSettings(), repo.answerButtons(), repo.swipeToRate(),
      ]);
      const today = studiedToday({ notes: n, cards: c, reviews, revlog, now, dayStartsAtHour: cs.dayStartsAtHour });
      setCollection(cs);
      setAnswerButtons(buttons);
      setSwipeOn(swipe);
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
    })();
  }, [repo, deck, reloads]);

  // Forms practice and lookalikes (src/ui/ReviewForms.tsx): held lookalikes, the offer to show a card sooner, suggestions.
  const forms = useReviewForms(repo, { cards, notes, deckSettings, now, dayStartsAtHour: H });
  const deckOf = useMemo(() => new Map([...notes.values()].map((n) => [n.id, n.deck])), [notes]);
  const queue = useMemo(() => {
    if (!cards) return null;
    return treeQueue(deck, queueInput({
      notes: notes.values(), cards, params: allParams, studied, gateFor: (d) => deckSettings.get(d)?.gateCap, collection, now, held: forms.held,
    }));
  }, [cards, notes, allParams, studied, deckSettings, collection, deck, now, forms.held]);

  const current = queue ? currentCard(queue, preferId) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  useEffect(() => { forms.showing({ card: current, note, revealed }); }, [current, note, revealed, forms.showing]); // eslint-disable-line react-hooks/exhaustive-deps
  // The card's own deck decides its FSRS settings, not the deck being studied.
  const cardParams = note && current ? paramsForDeck(cardHomeDeck(current, note.deck), allParams) : undefined;
  const noteType = note && current?.kind.startsWith('t') && !isOmnilanguage(note) ? noteTypes.get(note.model) : undefined;
  // What's typed into a {{type:}} card's box, compared on the back once the answer is shown.
  const [typed, setTyped] = useState('');
  // The box sits in the footer, so the screen is padded by the keyboard's height while it's up. The
  // keyboard covers the home indicator area the footer already leaves, so that much isn't added twice.
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboard(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboard(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const typedShown = revealed ? typed : '';
  const page = useMemo(() => {
    if (!note || !noteType || !current) return undefined;
    const ord = Number(current.kind.slice(1));
    const { front, back, typeAnswer } = renderTemplateCard(note, noteType, ord, typedShown);
    const opts = {
      css: noteType.css, ord, dark, autoplay: true, mediaBase: mediaBaseUri(),
      colors: { background: c.surface, text: c.text, cloze: c.countNew },
    };
    return { front: cardDocument(front, opts), back: cardDocument(back, opts), typeAnswer, frontAudio: sideAudio(front), backAudio: sideAudio(back) };
  }, [note, noteType, current?.id, current?.kind, dark, c, typedShown]); // eslint-disable-line react-hooks/exhaustive-deps
  const rendered = current && note && !page ? renderCard(note, current.kind) : undefined;
  // The fuzz seed and load balancer for answering the current card, as Anki has them: the buttons show what an answer does.
  const answerContext = (card: Card, when: Date): AnswerContext => {
    const seed = fuzzSeed(card.ankiId, card.sched.reps) ?? BigInt.asUintN(64, fnvHash(card.id) + BigInt(card.sched.reps));
    // A card in a filtered deck has no preset there, so Anki fuzzes it without balancing.
    const balance = collection.loadBalancer === false || card.filteredDeck ? undefined : balancerFor(loadSnapshot.current, card, {
      preset: cardParams?.presetId, seed, easyDays: cardParams?.easyDays, buryReviews: !!cardParams?.bury?.reviews,
      nextDayAt: nextStudyDayStart(when, H),
    });
    // A lookalike may have given the answer away: counted from when it was seen, unless turned off.
    return { seed, dayStartsAtHour: H, balance, countFrom: card.id === current?.id ? forms.countFrom : undefined };
  };
  const intervals = current && revealed ? previewIntervals(current.sched, now, cardParams, answerContext(current, now)) : undefined;

  // One player for the session's recorded audio, released when the screen closes.
  const player = useRef<AudioPlayer | null>(null);
  useEffect(() => () => { player.current?.remove(); player.current = null; Speech.stop(); }, []);

  /**
   * Says a side's word: the note's recording when it has one and the file is here, as Anki
   * plays it, else the phone's text-to-speech voice.
   */
  const speak = useCallback(
    (text?: string) => {
      if (!text || !rendered) return;
      Speech.stop();
      player.current?.pause();
      const uri = rendered.audioFile ? mediaFileUri(rendered.audioFile) : undefined;
      if (uri) {
        player.current ??= createAudioPlayer();
        player.current.replace({ uri });
        player.current.play();
        return;
      }
      Speech.speak(text, { language: rendered.speechLang, rate: 0.9 });
    },
    [rendered],
  );

  // Anki's {{tts:}} tags, read with the phone's voices: on their own when a side without a
  // recording is shown (a recording plays instead, in the page), and from each play button.
  const voices = useRef<Speech.Voice[]>([]);
  useEffect(() => { Speech.getAvailableVoicesAsync().then((v) => { voices.current = v; }).catch(() => {}); }, []);
  const readAloud = useCallback((tags: TtsTag[]) => {
    Speech.stop();
    for (const t of tags) Speech.speak(t.text, { language: speechLanguage(t.lang), voice: pickVoice(voices.current, t), rate: t.speed });
  }, []);
  const pageAudio = page && (revealed ? page.backAudio : page.frontAudio);
  useEffect(() => {
    if (!pageAudio) return;
    if (pageAudio.hasSound || !pageAudio.tts.length) Speech.stop();
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
  useEffect(() => { shownAt.current = Date.now(); }, [current?.id]);
  // Each card, and each time a card comes back, starts with an empty box.
  useEffect(() => { if (!revealed) setTyped(''); }, [current?.id, revealed]);

  // Auto-speak the front when a card with audio appears.
  useEffect(() => {
    if (rendered?.front.speak) speak(rendered.front.speak);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (rating: RatingValue) => {
    if (!current || !note || busy.current) return;
    busy.current = true;
    haptic.answer();
    try {
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
      await repo.saveCard(updated);
      for (const b of buried) await repo.saveCard(b);
      const reviewId = await repo.addReview({ cardId: current.id, ...res.log });
      // Into the kept Anki collection too, so "Send to Anki" carries this answer. If that write
      // fails, the answer still counts here, and you're told rather than it going missing.
      let anki: AnkiUndo | undefined;
      try {
        anki = await repo.writeAnkiAnswer({
          before: current, after: updated, rating, now: when,
          takenMs: when.getTime() - shownAt.current, desiredRetention: cardParams?.desiredRetention, bury: siblings,
          preview: preview ? { again: previewAgainAt } : undefined,
          steps: { learn: (cardParams?.learnSteps ?? DEFAULT_LEARN_STEPS).length, relearn: (cardParams?.relearnSteps ?? DEFAULT_RELEARN_STEPS).length },
        });
      } catch (e: any) {
        if (!warnedAnki.current) {
          warnedAnki.current = true;
          Alert.alert(
            "Couldn't save this answer for Anki",
            `It counts in Franki, but it won't be in the file sent to Anki. ${e?.message ?? e}`,
          );
        }
      }
      let leechNote: Note | undefined;
      if (isLeech && !note.tags.includes('leech')) {
        try {
          const tagged = await saveNote(repo as NoteStore, { id: note.id, deck: note.deck, model: note.model, fields: note.fields, tags: [...note.tags, 'leech'] }, when);
          leechNote = note;
          setNotes((prev) => new Map(prev).set(tagged.id, tagged));
        } catch {
          // The answer stands; the tag just isn't added.
        }
      }
      // Counted in the deck the card is studied in, as Anki counts it (a filtered deck's answers count there).
      // Time capped at a minute, as Anki's maximum answer time is, so a phone put down mid-card doesn't swell the summary.
      const record: AnswerRecord = {
        before: current, reviewId, deck: cardDeck(current, note.deck), anki, buried: siblings, leechNote,
        rating, takenMs: Math.min(when.getTime() - shownAt.current, 60000),
      };
      // Now a review, it weighs on the days the load balancer spreads later answers over, as in Anki.
      if (updated.sched.state === 2) recordAnswer(loadSnapshot.current, updated, cardParams?.presetId, updated.sched.scheduledDays);
      setStudied((s) => bumpStudied(s, record.deck, studiedKind(record.before, H), 1));
      setHistory((h) => [...h, record]);
      forms.answered({ cardId: current.id, ...res.log });
      // Functional update: `cards` from this render's closure is stale once the awaits return.
      const changed = new Map([updated, ...buried].map((c) => [c.id, c]));
      setCards((prev) => prev && prev.map((c) => changed.get(c.id) ?? c));
      setPreferId(undefined);
      setRevealed(false);
      setNow(when);
    } finally {
      busy.current = false;
    }
  };

  const undo = async () => {
    const last = history[history.length - 1];
    if (!last || busy.current) return;
    busy.current = true;
    haptic.tap();
    try {
      // Out of the Anki collection first: a synced answer is in the server's history, and taking
      // it back here alone would leave the two disagreeing. As in Anki, undo stops at the last sync.
      if (last.anki && !(await repo.undoAnkiAnswer(last.anki))) {
        setHistory([]);
        Alert.alert("Couldn't undo that answer", 'It has already been synced to your Anki server. Undo only goes back to the last sync.');
        return;
      }
      await repo.saveCard(last.before);
      for (const s of last.buried) await repo.saveCard(s);
      if (last.leechNote) {
        const n = last.leechNote;
        try {
          const restored = await saveNote(repo as NoteStore, { id: n.id, deck: n.deck, model: n.model, fields: n.fields, tags: n.tags });
          setNotes((prev) => new Map(prev).set(restored.id, restored));
        } catch { /* the tag stays */ }
      }
      await repo.deleteReview(last.reviewId);
      forgetCard(loadSnapshot.current, last.before.id);
      setHistory((h) => h.slice(0, -1));
      forms.undone(last.before.id);
      setStudied((s) => bumpStudied(s, last.deck, studiedKind(last.before, H), -1));
      const restored = new Map([last.before, ...last.buried].map((c) => [c.id, c]));
      setCards((prev) => prev && prev.map((c) => restored.get(c.id) ?? c));
      setPreferId(last.before.id);
      setRevealed(false);
      setNow(new Date());
    } finally {
      busy.current = false;
    }
  };

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
  if (!cards) return <Screen title={title} largeTitle={false}><View /></Screen>;

  const undoButton = history.length
    ? <Stack.Toolbar.Button icon="arrow.uturn.backward" accessibilityLabel="Undo the last answer" onPress={undo} />
    : null;

  if (!current || !note || (!rendered && !page)) {
    const minutes = waitingFor ? Math.max(1, Math.ceil((waitingFor.getTime() - Date.now()) / 60000) - collection.learnAheadMinutes) : 0;
    const studiedWords = practice ? practiceWords(history.map((h) => ({ noteId: h.before.noteId, deck: h.deck })), notes, practice.languageDeck) : [];
    const reading = !!(studiedWords.length && practice);
    const checking = forms.toCheck.length;
    const footer = (
      <>
        {checking ? (
          <Button
            label={checking === 1 ? 'Practice its forms' : `Practice these ${checking}`}
            onPress={() => onPracticeForms(forms.drillFor(forms.toCheck.map((x) => x.note.id), deck))}
          />
        ) : null}
        {reading ? <Button label="Read a text with these words" variant={checking ? 'secondary' : 'primary'} onPress={() => practice!.onRead(studiedWords)} /> : null}
        <Button label="Back to decks" variant={reading || checking ? 'secondary' : 'primary'} onPress={onDone} />
      </>
    );
    return (
      <Screen
        title={title}
        largeTitle={false}
        toolbar={undoButton ? <Stack.Toolbar placement="right">{undoButton}</Stack.Toolbar> : undefined}
        footer={footer}
      >
        <Reveal style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s, padding: space.xl }}>
          <Icon name={waitingFor ? 'clock' : 'checkmark.circle.fill'} size={56} color={waitingFor ? c.textTertiary : c.countDue} weight="regular" />
          <Text style={{ ...type.title, color: c.text, textAlign: 'center', marginTop: space.s }}>
            {waitingFor ? 'Nothing due right now' : 'All done for now'}
          </Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {waitingFor ? `The next card comes back in about ${minutes} min.` : 'Nothing else is due in this deck today.'}
          </Text>
          {history.length ? <SessionSummary history={history} /> : null}
          <FormsCheck items={forms.toCheck} />
        </Reveal>
      </Screen>
    );
  }

  const reveal = () => { Keyboard.dismiss(); setRevealed(true); if (rendered?.back.speak) speak(rendered.back.speak); };
  // Under the answer: the offer to show the card sooner, and the suggestion to practice its forms.
  const extras = revealed ? (
    <AnswerExtras
      word={headword(note)}
      offer={forms.offerView((from) => previewIntervals(current.sched, now, cardParams, { ...answerContext(current, now), countFrom: from })[3])}
      onSooner={forms.setSooner}
      suggestion={forms.suggestion}
      onPractice={() => onPracticeForms(forms.drillFor([note.id], note.deck))}
      onLater={() => forms.putOff(note.id)}
    />
  ) : null;
  const shown = ratingsShown(answerButtons);
  const buttons = ([
    { r: 1, label: 'Again', color: c.again },
    { r: 2, label: 'Hard', color: c.hard, on: c.onHard },
    { r: 3, label: 'Good', color: c.good },
    { r: 4, label: 'Easy', color: c.easy },
  ] as { r: RatingValue; label: string; color: string; on?: string }[]).filter((b) => shown.includes(b.r));

  const footer = revealed ? (
    <Reveal rise={6} style={{ flexDirection: 'row', gap: space.s }}>
      {buttons.map((b) => (
        <Tappable
          key={b.r}
          onPress={() => answer(b.r)}
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
          <Text style={{ ...type.caption, color: b.on ?? c.onRating, fontVariant: ['tabular-nums'] }}>{intervals?.[b.r]}</Text>
          <Text style={{ ...type.headline, color: b.on ?? c.onRating }}>{b.label}</Text>
        </Tappable>
      ))}
    </Reveal>
  ) : (
    <>
      {page?.typeAnswer ? (
        <TextInput
          key={current.id}
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={reveal}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="done"
          placeholder="Type the answer"
          accessibilityLabel="Type the answer"
          placeholderTextColor={c.textTertiary}
          selectionColor={c.accent}
          keyboardAppearance={dark ? 'dark' : 'light'}
          style={{
            ...type.body, color: c.text, backgroundColor: c.surface, ...smooth, borderRadius: radius.m,
            borderWidth: hairline, borderColor: c.border, paddingHorizontal: space.m, paddingVertical: space.s, minHeight: MIN_TAP,
          }}
        />
      ) : null}
      <Button label="Show answer" onPress={reveal} />
    </>
  );

  // Suspend, bury or flag cards from the menu: in Franki first, then in the kept collection, as Anki writes it.
  const setStates = async (targets: Card[], change: (s: CardState) => CardState) => {
    if (busy.current || !targets.length) return;
    busy.current = true;
    try {
      const when = new Date();
      const { cards: updated, ankiError } = await setCardStates(repo, targets, change, when, H);
      if (ankiError) {
        Alert.alert("Couldn't save this change for Anki", `It's made in Franki, but it won't reach Anki. ${(ankiError as any)?.message ?? ankiError}`);
      }
      const byId = new Map(updated.map((u) => [u.id, u]));
      setCards((prev) => prev && prev.map((c) => byId.get(c.id) ?? c));
      setRevealed(false);
      setNow(when);
    } finally {
      busy.current = false;
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
  const openMenu = () => {
    const options = ['Flag', 'Bury card', 'Bury note', 'Suspend card', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 4, destructiveButtonIndex: 3 }, (i) => {
      // Bury holds a card back until the next study day; Bury note does it to every card of the note; Suspend until it's unsuspended.
      if (i === 0) chooseFlag();
      if (i === 1) setStates([current], (s) => ({ ...s, buried: true }));
      if (i === 2) setStates(noteCards(current, cards ?? []), (s) => ({ ...s, buried: true }));
      if (i === 3) setStates([current], (s) => ({ ...s, suspended: true }));
    });
  };

  return (
    <View style={{ flex: 1, paddingBottom: Math.max(0, keyboard - insets.bottom) }}>
    <Screen
      title={title}
      largeTitle={false}
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
          <Stack.Toolbar.Button icon="ellipsis.circle" accessibilityLabel="Flag, bury or suspend this card" onPress={openMenu} />
        </Stack.Toolbar>
      }
      footer={footer}
    >
      {queue ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          <Count value={queue.due.length} label="due" color={c.countDue} />
          <Count value={queue.fresh.length} label="new" color={c.countNew} />
        </View>
      ) : null}
      {queue ? <ProgressBar value={sessionProgress(history.length, queue.due.length + queue.fresh.length)} /> : null}
      {page ? (
        <CardSurface>
          <CardWebView key={`${current.id}:${revealed ? 'back' : 'front'}`} html={revealed ? page.back : page.front} onMessage={onPageMessage} />
        </CardSurface>
      ) : null}
      {page && extras ? (
        <ScrollView style={{ flexGrow: 0, maxHeight: '45%' }} contentContainerStyle={{ paddingHorizontal: space.l, paddingVertical: space.s }}>{extras}</ScrollView>
      ) : null}
      {page ? null : rendered ? (
        <SwipeCard enabled={swipeOn && revealed} shown={shown} onRate={answer}>
          {/* Tapping the card shows the answer. Not an accessibility element itself: the card's text stays readable, and Show answer is the control VoiceOver uses. */}
          <Pressable accessible={false} disabled={revealed} onPress={() => { haptic.select(); reveal(); }} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
            {/* Keyed to the card, so each new one fades in rather than swapping. */}
            <Reveal key={current.id} rise={10} style={{ gap: space.xl }}>
              <Side side={rendered.front} which="front" />
              {rendered.front.speak || rendered.back.speak ? (
                <Tappable
                  onPress={() => { haptic.tap(); speak(rendered.back.speak ?? rendered.front.speak); }}
                  accessibilityRole="button"
                  accessibilityLabel="Play the word"
                  scaleTo={0.94}
                  style={{
                    alignSelf: 'center', minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', gap: space.s,
                    paddingHorizontal: space.l, borderRadius: radius.pill, backgroundColor: c.fill,
                  }}
                >
                  <Icon name="speaker.wave.2.fill" size={18} color={c.accent} />
                  <Text style={{ ...type.callout, color: c.accent, fontWeight: '600' }}>Play</Text>
                </Tappable>
              ) : null}
            </Reveal>
            {revealed ? (
              <Reveal rise={8} style={{ gap: space.xl }}>
                <View style={{ height: hairline, backgroundColor: c.border }} />
                <Side side={rendered.back} which="back" />
                {extras}
              </Reveal>
            ) : null}
          </ScrollView>
          </Pressable>
        </SwipeCard>
      ) : null}
      {swipeOn && revealed && rendered ? (
        <Text style={{ ...type.footnote, color: c.textSecondary, textAlign: 'center' }}>Swipe right for Good, left for Again</Text>
      ) : null}
    </Screen>
    </View>
  );
}
