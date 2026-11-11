import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import { isOmnilanguage, renderCard } from '../core/cards';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, NEW_PER_DAY, REVIEWS_PER_DAY } from '../core/config';
import { deckLimits, groupByDeck, isInDeck, treeQueue } from '../core/deckTree';
import { nextLearningDue, type StudiedToday } from '../core/queue';
import { ratingsShown, type AnswerButtons } from '../core/answerButtons';
import { paramsForDeck, previewIntervals, review, type RatingValue } from '../core/scheduler';
import { bumpStudied, currentCard, type AnswerRecord } from '../core/session';
import { cardDocument, renderTemplateCard } from '../core/template';
import type { Card, DeckParams, DeckSettings, Note, NoteType, RenderedSide } from '../core/types';
import type { AnkiUndo } from '../anki/writeback';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { mediaBaseUri, mediaFileUri } from '../media/mediaFiles';
import { CardWebView } from './CardWebView';
import { NoteEditor } from './NoteEditor';
import { Button, Count, HeaderAction, Screen } from './kit';
import { MIN_TAP, radius, space, type, useTheme } from './theme';

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
            <Text style={{ ...type.caption, fontWeight: '600', color: c.accent, letterSpacing: 0.8, textTransform: 'uppercase' }}>{b.label}</Text>
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

const DEFAULT_LIMITS = { newPerDay: NEW_PER_DAY, reviewsPerDay: REVIEWS_PER_DAY };

/**
 * Studies `deck` and its subdecks. Each card is scheduled with its own deck's FSRS settings, and
 * every deck's daily limits apply (`treeQueue`). Omnilanguage cards render natively with TTS;
 * other note types render their Anki templates in a WebView.
 */
export function Review({ repo, deck, onDone }: { repo: Repo & AnkiLink; deck: string; onDone: () => void }) {
  const c = useTheme();
  const dark = useColorScheme() === 'dark';
  const [cards, setCards] = useState<Card[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [studied, setStudied] = useState<Map<string, StudiedToday>>(new Map());
  const [allParams, setAllParams] = useState<Map<string, DeckParams>>(new Map());
  const [answerButtons, setAnswerButtons] = useState<AnswerButtons>('all');
  // Bumped after the note editor saves or deletes, to load the cards and notes again.
  const [reloads, setReloads] = useState(0);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [deckSettings, setDeckSettings] = useState<Map<string, DeckSettings>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [preferId, setPreferId] = useState<string>();
  // Set while an answer or an undo is being written. A second tap during the await would
  // otherwise act on the same card again from its old state.
  const busy = useRef(false);

  useEffect(() => {
    (async () => {
      const [c, n, today, params, types, settings, buttons] = await Promise.all([
        // Every card, not only this deck's: a gate on a deck above this one counts its whole subtree.
        repo.listCards(), repo.listNotes(), repo.studiedToday(new Date(), DAY_STARTS_AT_HOUR),
        repo.listDeckParams(), repo.listNoteTypes(), repo.listDeckSettings(), repo.answerButtons(),
      ]);
      setAnswerButtons(buttons);
      setDeckSettings(settings);
      setAllParams(params);
      setNoteTypes(types);
      setStudied(today);
      setNotes(new Map(n.map((x) => [x.id, x])));
      setCards(c);
    })();
  }, [repo, deck, reloads]);

  const deckOf = useMemo(() => new Map([...notes.values()].map((n) => [n.id, n.deck])), [notes]);
  const queue = useMemo(() => {
    if (!cards) return null;
    return treeQueue(deck, {
      cardsByDeck: groupByDeck(cards, deckOf),
      limitsFor: (d) => deckLimits(paramsForDeck(d, allParams), DEFAULT_LIMITS),
      studiedByDeck: studied,
      gateFor: (d) => deckSettings.get(d)?.gateCap,
      dayStartsAtHour: DAY_STARTS_AT_HOUR,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      now,
    });
  }, [cards, deckOf, allParams, studied, deckSettings, deck, now]);

  const current = queue ? currentCard(queue, preferId) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  // The card's own deck decides its FSRS settings, not the deck being studied.
  const cardParams = note ? paramsForDeck(note.deck, allParams) : undefined;
  const noteType = note && current?.kind.startsWith('t') && !isOmnilanguage(note) ? noteTypes.get(note.model) : undefined;
  const page = useMemo(() => {
    if (!note || !noteType || !current) return undefined;
    const ord = Number(current.kind.slice(1));
    const { front, back } = renderTemplateCard(note, noteType, ord);
    const opts = {
      css: noteType.css, ord, dark, autoplay: true, mediaBase: mediaBaseUri(),
      colors: { background: c.surface, text: c.text, cloze: c.countNew },
    };
    return { front: cardDocument(front, opts), back: cardDocument(back, opts) };
  }, [note, noteType, current?.id, current?.kind, dark, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const rendered = current && note && !page ? renderCard(note, current.kind) : undefined;
  const intervals = current && revealed ? previewIntervals(current.sched, now, cardParams) : undefined;

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

  // When the card came up, for the time Anki records against each answer.
  const shownAt = useRef(Date.now());
  // One warning per session if answers can't be written into the Anki collection.
  const warnedAnki = useRef(false);
  useEffect(() => { shownAt.current = Date.now(); }, [current?.id]);

  // Auto-speak the front when a card with audio appears.
  useEffect(() => {
    if (rendered?.front.speak) speak(rendered.front.speak);
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = async (rating: RatingValue) => {
    if (!current || !note || busy.current) return;
    busy.current = true;
    try {
      const when = new Date();
      const res = review(current.sched, rating, when, cardParams);
      const updated: Card = { ...current, sched: res.sched };
      await repo.saveCard(updated);
      const reviewId = await repo.addReview({ cardId: current.id, ...res.log });
      // Into the kept Anki collection too, so "Send to Anki" carries this answer. If that write
      // fails, the answer still counts here, and you're told rather than it going missing.
      let anki: AnkiUndo | undefined;
      try {
        anki = await repo.writeAnkiAnswer({
          before: current, after: updated, rating, now: when,
          takenMs: when.getTime() - shownAt.current, desiredRetention: cardParams?.desiredRetention,
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
      const record: AnswerRecord = { before: current, reviewId, deck: note.deck, anki };
      setStudied((s) => bumpStudied(s, record.deck, record.before.sched.state, 1));
      setHistory((h) => [...h, record]);
      // Functional update: `cards` from this render's closure is stale once the awaits return.
      setCards((prev) => prev && prev.map((c) => (c.id === updated.id ? updated : c)));
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
    try {
      // Out of the Anki collection first: a synced answer is in the server's history, and taking
      // it back here alone would leave the two disagreeing. As in Anki, undo stops at the last sync.
      if (last.anki && !(await repo.undoAnkiAnswer(last.anki))) {
        setHistory([]);
        Alert.alert("Couldn't undo that answer", 'It has already been synced to your Anki server. Undo only goes back to the last sync.');
        return;
      }
      await repo.saveCard(last.before);
      await repo.deleteReview(last.reviewId);
      setHistory((h) => h.slice(0, -1));
      setStudied((s) => bumpStudied(s, last.deck, last.before.sched.state, -1));
      setCards((prev) => prev && prev.map((c) => (c.id === last.before.id ? last.before : c)));
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
    ? nextLearningDue(cards.filter((c) => isInDeck(deckOf.get(c.noteId) ?? '', deck)))
    : undefined;
  useEffect(() => {
    if (!waitingFor) return;
    const wake = waitingFor.getTime() - LEARN_AHEAD_MINUTES * 60000 - Date.now();
    const id = setTimeout(() => setNow(new Date()), Math.max(0, wake) + 1000);
    return () => clearTimeout(id);
  }, [waitingFor?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cards) return <Screen onBack={onDone}><View /></Screen>;

  const undoAction = history.length ? <HeaderAction label="Undo" onPress={undo} accessibilityLabel="Undo the last answer" /> : undefined;

  if (!current || !note || (!rendered && !page)) {
    const minutes = waitingFor ? Math.max(1, Math.ceil((waitingFor.getTime() - Date.now()) / 60000) - LEARN_AHEAD_MINUTES) : 0;
    return (
      <Screen onBack={onDone} right={undoAction} footer={<Button label="Back to decks" onPress={onDone} />}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s, padding: space.xl }}>
          <Text style={{ ...type.title, color: c.text, textAlign: 'center' }}>
            {waitingFor ? 'Nothing due right now' : 'All done for now'}
          </Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {waitingFor ? `The next card comes back in about ${minutes} min.` : 'Nothing else is due in this deck today.'}
          </Text>
        </View>
      </Screen>
    );
  }

  const shown = ratingsShown(answerButtons);
  const buttons = ([
    { r: 1, label: 'Again', color: c.again },
    { r: 2, label: 'Hard', color: c.hard },
    { r: 3, label: 'Good', color: c.good },
    { r: 4, label: 'Easy', color: c.easy },
  ] as { r: RatingValue; label: string; color: string }[]).filter((b) => shown.includes(b.r));

  const footer = revealed ? (
    <View style={{ flexDirection: 'row', gap: space.s }}>
      {buttons.map((b) => (
        <Pressable
          key={b.r}
          onPress={() => answer(b.r)}
          accessibilityRole="button"
          accessibilityLabel={`${b.label}, next in ${intervals?.[b.r] ?? ''}`}
          style={({ pressed }) => ({
            flex: 1, minHeight: 56, borderRadius: radius.m, paddingVertical: space.s,
            alignItems: 'center', justifyContent: 'center', gap: 2,
            backgroundColor: b.color, opacity: pressed ? 0.75 : 1,
          })}
        >
          {/* The interval sits above the label, as in Anki, so the eye lands on when it's next due. */}
          <Text style={{ ...type.caption, color: c.onRating, opacity: 0.85 }}>{intervals?.[b.r]}</Text>
          <Text style={{ ...type.headline, color: c.onRating }}>{b.label}</Text>
        </Pressable>
      ))}
    </View>
  ) : (
    <Button label="Show answer" onPress={() => { setRevealed(true); if (rendered?.back.speak) speak(rendered.back.speak); }} />
  );

  return (
    <Screen
      onBack={onDone}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          {queue ? (
            <View style={{ flexDirection: 'row', gap: space.m, paddingHorizontal: space.s }}>
              <Count value={queue.due.length} label="due" color={c.countDue} />
              <Count value={queue.fresh.length} label="new" color={c.countNew} />
            </View>
          ) : null}
          <HeaderAction label="Edit" onPress={() => setEditingNote(note.id)} accessibilityLabel="Edit this card's note" />
          {undoAction}
        </View>
      }
      footer={footer}
    >
      {editingNote ? (
        <NoteEditor
          repo={repo}
          target={{ noteId: editingNote }}
          onClose={(result) => {
            setEditingNote(null);
            if (!result) return;
            // A deleted note's cards are gone, so an answer to one can't be undone any more.
            if ('deleted' in result) setHistory([]);
            else setPreferId(current.id);
            setReloads((r) => r + 1);
          }}
        />
      ) : null}
      {page ? (
        <View style={{ flex: 1, marginHorizontal: space.l, marginTop: space.s, borderRadius: radius.l, overflow: 'hidden', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border }}>
          <CardWebView key={`${current.id}:${revealed ? 'back' : 'front'}`} html={revealed ? page.back : page.front} />
        </View>
      ) : rendered ? (
        <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.xl, flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <Side side={rendered.front} which="front" />
          {rendered.front.speak || rendered.back.speak ? (
            <Pressable
              onPress={() => speak(rendered.back.speak ?? rendered.front.speak)}
              accessibilityRole="button"
              accessibilityLabel="Play the word"
              style={({ pressed }) => ({
                alignSelf: 'center', minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: space.l,
                borderRadius: radius.pill, backgroundColor: c.fill, opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text style={{ ...type.callout, color: c.accent }}>🔊 Play</Text>
            </Pressable>
          ) : null}
          {revealed ? (
            <>
              <View style={{ height: 1, backgroundColor: c.border }} />
              <Side side={rendered.back} which="back" />
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
