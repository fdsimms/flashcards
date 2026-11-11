import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import { isOmnilanguage, renderCard } from '../core/cards';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, NEW_PER_DAY, REVIEWS_PER_DAY } from '../core/config';
import { deckLimits, groupByDeck, treeQueue } from '../core/deckTree';
import { nextLearningDue, type StudiedToday } from '../core/queue';
import { paramsForDeck, previewIntervals, review, type RatingValue } from '../core/scheduler';
import { bumpStudied, currentCard, type AnswerRecord } from '../core/session';
import { cardDocument, renderTemplateCard } from '../core/template';
import type { Card, DeckParams, Note, NoteType, RenderedSide } from '../core/types';
import type { Repo } from '../db/repo';
import { mediaBaseUri } from '../media/mediaFiles';
import { CardWebView } from './CardWebView';
import { useTheme } from './theme';

function Side({ side }: { side: RenderedSide }) {
  const t = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {side.blocks.map((b, i) => (
        <View key={i}>
          {b.label ? <Text style={{ color: t.accent, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' }}>{b.label}</Text> : null}
          <Text style={{ color: b.emphasis ? t.text : t.sub, fontSize: b.emphasis ? 28 : 17, textAlign: b.emphasis ? 'center' : 'left' }}>
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
export function Review({ repo, deck, onDone }: { repo: Repo; deck: string; onDone: () => void }) {
  const t = useTheme();
  const dark = useColorScheme() === 'dark';
  const [cards, setCards] = useState<Card[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [studied, setStudied] = useState<Map<string, StudiedToday>>(new Map());
  const [allParams, setAllParams] = useState<Map<string, DeckParams>>(new Map());
  const [noteTypes, setNoteTypes] = useState<Map<string, NoteType>>(new Map());
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [history, setHistory] = useState<AnswerRecord[]>([]);
  const [preferId, setPreferId] = useState<string>();
  // Set while an answer or an undo is being written. A second tap during the await would
  // otherwise act on the same card again from its old state.
  const busy = useRef(false);

  useEffect(() => {
    (async () => {
      const [c, n, today, params, types] = await Promise.all([
        repo.listCards(deck), repo.listNotes(), repo.studiedToday(new Date(), DAY_STARTS_AT_HOUR),
        repo.listDeckParams(), repo.listNoteTypes(),
      ]);
      setAllParams(params);
      setNoteTypes(types);
      setStudied(today);
      setNotes(new Map(n.map((x) => [x.id, x])));
      setCards(c);
    })();
  }, [repo, deck]);

  const deckOf = useMemo(() => new Map([...notes.values()].map((n) => [n.id, n.deck])), [notes]);
  const queue = useMemo(() => {
    if (!cards) return null;
    return treeQueue(deck, {
      cardsByDeck: groupByDeck(cards, deckOf),
      limitsFor: (d) => deckLimits(paramsForDeck(d, allParams), DEFAULT_LIMITS),
      studiedByDeck: studied,
      dayStartsAtHour: DAY_STARTS_AT_HOUR,
      learnAheadMinutes: LEARN_AHEAD_MINUTES,
      now,
    });
  }, [cards, deckOf, allParams, studied, deck, now]);

  const current = queue ? currentCard(queue, preferId) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  // The card's own deck decides its FSRS settings, not the deck being studied.
  const cardParams = note ? paramsForDeck(note.deck, allParams) : undefined;
  const noteType = note && current?.kind.startsWith('t') && !isOmnilanguage(note) ? noteTypes.get(note.model) : undefined;
  const page = useMemo(() => {
    if (!note || !noteType || !current) return undefined;
    const ord = Number(current.kind.slice(1));
    const { front, back } = renderTemplateCard(note, noteType, ord);
    const opts = { css: noteType.css, ord, dark, autoplay: true, mediaBase: mediaBaseUri() };
    return { front: cardDocument(front, opts), back: cardDocument(back, opts) };
  }, [note, noteType, current?.id, current?.kind, dark]); // eslint-disable-line react-hooks/exhaustive-deps
  const rendered = current && note && !page ? renderCard(note, current.kind) : undefined;
  const intervals = current && revealed ? previewIntervals(current.sched, now, cardParams) : undefined;

  const speak = useCallback(
    (text?: string) => {
      if (!text || !rendered) return;
      Speech.stop();
      Speech.speak(text, { language: rendered.speechLang, rate: 0.9 });
    },
    [rendered],
  );

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
      const record: AnswerRecord = { before: current, reviewId, deck: note.deck };
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
  const waitingFor = !current && cards ? nextLearningDue(cards) : undefined;
  useEffect(() => {
    if (!waitingFor) return;
    const wake = waitingFor.getTime() - LEARN_AHEAD_MINUTES * 60000 - Date.now();
    const id = setTimeout(() => setNow(new Date()), Math.max(0, wake) + 1000);
    return () => clearTimeout(id);
  }, [waitingFor?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cards) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  const header = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, gap: 12 }}>
      <Pressable onPress={onDone}><Text style={{ color: t.accent, fontSize: 16 }}>‹ Decks</Text></Pressable>
      {queue && current ? <Text style={{ color: t.sub }}>{queue.due.length} due · {queue.fresh.length} new</Text> : null}
      {history.length ? (
        <Pressable onPress={undo} hitSlop={12}><Text style={{ color: t.accent, fontSize: 16 }}>Undo</Text></Pressable>
      ) : <View style={{ width: 40 }} />}
    </View>
  );

  if (!current || !note || (!rendered && !page)) {
    const minutes = waitingFor ? Math.max(1, Math.ceil((waitingFor.getTime() - Date.now()) / 60000) - LEARN_AHEAD_MINUTES) : 0;
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 56 }}>
        {header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <Text style={{ color: t.text, fontSize: 22 }}>{waitingFor ? 'Nothing due right now' : 'All done for now 🎉'}</Text>
          {waitingFor ? <Text style={{ color: t.sub }}>The next card comes back in about {minutes} min.</Text> : null}
          <Pressable onPress={onDone} style={{ backgroundColor: t.accent, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Back to decks</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const buttons: { r: RatingValue; label: string; color: string }[] = [
    { r: 1, label: 'Again', color: t.again },
    { r: 2, label: 'Hard', color: t.hard },
    { r: 3, label: 'Good', color: t.good },
    { r: 4, label: 'Easy', color: t.easy },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 56 }}>
      {header}
      {page ? (
        <View style={{ flex: 1, marginTop: 12 }}>
          <CardWebView key={`${current.id}:${revealed ? 'back' : 'front'}`} html={revealed ? page.back : page.front} />
        </View>
      ) : rendered ? (
        <ScrollView contentContainerStyle={{ padding: 24, gap: 24, flexGrow: 1, justifyContent: 'center' }}>
          <Side side={rendered.front} />
          {rendered.front.speak || rendered.back.speak ? (
            <Pressable onPress={() => speak(rendered.back.speak ?? rendered.front.speak)} style={{ alignSelf: 'center' }}>
              <Text style={{ color: t.accent, fontSize: 18 }}>🔊 Play</Text>
            </Pressable>
          ) : null}
          {revealed ? (
            <>
              <View style={{ height: 1, backgroundColor: t.border }} />
              <Side side={rendered.back} />
            </>
          ) : null}
        </ScrollView>
      ) : null}
      <View style={{ padding: 16, paddingBottom: 36 }}>
        {revealed ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {buttons.map((b) => (
              <Pressable key={b.r} onPress={() => answer(b.r)} style={{ flex: 1, backgroundColor: b.color, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>{b.label}</Text>
                <Text style={{ color: '#ffffffcc', fontSize: 12 }}>{intervals?.[b.r]}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Pressable
            onPress={() => { setRevealed(true); if (rendered?.back.speak) speak(rendered.back.speak); }}
            style={{ backgroundColor: t.accent, borderRadius: 14, padding: 16, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Show answer</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
