import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, useColorScheme, View } from 'react-native';
import { isOmnilanguage, renderCard } from '../core/cards';
import { DEFAULT_COLLECTION_SETTINGS } from '../core/config';
import { cardDeck, cardHomeDeck, isInDeck, queueInput, treeQueue } from '../core/deckTree';
import { studyDayStart } from '../core/day';
import { nextLearningDue, siblingsToBury, studiedKind, studiedToday, type StudiedToday } from '../core/queue';
import { ratingsShown, type AnswerButtons } from '../core/answerButtons';
import { becameLeech, DEFAULT_LEARN_STEPS, DEFAULT_LEECH, DEFAULT_RELEARN_STEPS, paramsForDeck, previewIntervals, review, type RatingValue } from '../core/scheduler';
import { saveNote, type NoteStore } from '../anki/noteService';
import { bumpStudied, currentCard, type AnswerRecord } from '../core/session';
import { cardDocument, renderTemplateCard } from '../core/template';
import type { Card, CollectionSettings, DeckParams, DeckSettings, Note, NoteType, RenderedSide } from '../core/types';
import type { AnkiUndo } from '../anki/writeback';
import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { mediaBaseUri, mediaFileUri } from '../media/mediaFiles';
import { CardWebView } from './CardWebView';
import { NoteEditor } from './NoteEditor';
import { haptic } from './haptics';
import { Button, Count, Icon, IconAction, Screen, Tappable } from './kit';
import { Reveal } from './motion';
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
  // The Anki collection's day start, learn-ahead limit and v3 options.
  const [collection, setCollection] = useState<CollectionSettings>(DEFAULT_COLLECTION_SETTINGS);
  const H = collection.dayStartsAtHour;
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
      const now = new Date();
      const cs = await repo.collectionSettings();
      const dayStart = studyDayStart(now, cs.dayStartsAtHour);
      const [c, n, reviews, revlog, params, types, settings, buttons] = await Promise.all([
        // Every card, not only this deck's: a gate on a deck above this one counts its whole subtree.
        repo.listCards(), repo.listNotes(), repo.listReviews(dayStart), repo.ankiReviewLog(dayStart),
        repo.listDeckParams(), repo.listNoteTypes(), repo.listDeckSettings(), repo.answerButtons(),
      ]);
      const today = studiedToday({ notes: n, cards: c, reviews, revlog, now, dayStartsAtHour: cs.dayStartsAtHour });
      setCollection(cs);
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
    return treeQueue(deck, queueInput({
      notes: notes.values(), cards, params: allParams, studied, gateFor: (d) => deckSettings.get(d)?.gateCap, collection, now,
    }));
  }, [cards, notes, allParams, studied, deckSettings, collection, deck, now]);

  const current = queue ? currentCard(queue, preferId) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  // The card's own deck decides its FSRS settings, not the deck being studied.
  const cardParams = note && current ? paramsForDeck(cardHomeDeck(current, note.deck), allParams) : undefined;
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
    haptic.answer();
    try {
      const when = new Date();
      const res = review(current.sched, rating, when, cardParams);
      // A forgotten review can make the card a leech: its note is tagged, and the card suspended if the preset says so, as in Anki.
      const leech = cardParams?.leech ?? DEFAULT_LEECH;
      const isLeech = becameLeech(current.sched, res.sched, leech);
      const updated: Card = { ...current, sched: res.sched, buriedAt: undefined, suspended: current.suspended || (isLeech && leech.suspend) };
      // The note's other cards that its preset holds back until tomorrow, as Anki does.
      const siblings = siblingsToBury(current, cards ?? [], cardParams?.bury, when, H);
      const buried = siblings.map((s): Card => ({ ...s, buriedAt: when.toISOString() }));
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
      const record: AnswerRecord = { before: current, reviewId, deck: cardDeck(current, note.deck), anki, buried: siblings, leechNote };
      setStudied((s) => bumpStudied(s, record.deck, studiedKind(record.before, H), 1));
      setHistory((h) => [...h, record]);
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
      setHistory((h) => h.slice(0, -1));
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

  if (!cards) return <Screen onBack={onDone}><View /></Screen>;

  const undoAction = history.length ? <IconAction name="arrow.uturn.backward" label="Undo the last answer" onPress={undo} /> : undefined;

  if (!current || !note || (!rendered && !page)) {
    const minutes = waitingFor ? Math.max(1, Math.ceil((waitingFor.getTime() - Date.now()) / 60000) - collection.learnAheadMinutes) : 0;
    return (
      <Screen onBack={onDone} right={undoAction} footer={<Button label="Back to decks" onPress={onDone} />}>
        <Reveal style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.s, padding: space.xl }}>
          <Icon name={waitingFor ? 'clock' : 'checkmark.circle.fill'} size={56} color={waitingFor ? c.textTertiary : c.countDue} weight="regular" />
          <Text style={{ ...type.title, color: c.text, textAlign: 'center', marginTop: space.s }}>
            {waitingFor ? 'Nothing due right now' : 'All done for now'}
          </Text>
          <Text style={{ ...type.body, color: c.textSecondary, textAlign: 'center' }}>
            {waitingFor ? `The next card comes back in about ${minutes} min.` : 'Nothing else is due in this deck today.'}
          </Text>
        </Reveal>
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
          <Text style={{ ...type.caption, color: c.onRating, opacity: 0.85, fontVariant: ['tabular-nums'] }}>{intervals?.[b.r]}</Text>
          <Text style={{ ...type.headline, color: c.onRating }}>{b.label}</Text>
        </Tappable>
      ))}
    </Reveal>
  ) : (
    <Button label="Show answer" onPress={() => { setRevealed(true); if (rendered?.back.speak) speak(rendered.back.speak); }} />
  );

  return (
    <Screen
      onBack={onDone}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {undoAction}
          <IconAction name="pencil" label="Edit this card's note" onPress={() => setEditingNote(note.id)} />
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
      {queue ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
          <Count value={queue.due.length} label="due" color={c.countDue} />
          <Count value={queue.fresh.length} label="new" color={c.countNew} />
        </View>
      ) : null}
      {page ? (
        <CardSurface>
          <CardWebView key={`${current.id}:${revealed ? 'back' : 'front'}`} html={revealed ? page.back : page.front} />
        </CardSurface>
      ) : rendered ? (
        <CardSurface>
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
              </Reveal>
            ) : null}
          </ScrollView>
        </CardSurface>
      ) : null}
    </Screen>
  );
}
