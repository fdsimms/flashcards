import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { renderCard } from '../core/cards';
import { DAY_STARTS_AT_HOUR, LEARN_AHEAD_MINUTES, STUDY_DEFAULTS } from '../core/config';
import { buildQueue, nextCard, nextLearningDue, queueOptionsFor, type StudiedToday } from '../core/queue';
import { paramsForDeck, previewIntervals, review, type RatingValue } from '../core/scheduler';
import type { Card, DeckParams, Note, RenderedSide } from '../core/types';
import type { Repo } from '../db/repo';
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

export function Review({ repo, deck, onDone }: { repo: Repo; deck: string; onDone: () => void }) {
  const t = useTheme();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [notes, setNotes] = useState<Map<string, Note>>(new Map());
  const [studied, setStudied] = useState<StudiedToday>({ introduced: 0, reviewed: 0 });
  const [params, setParams] = useState<DeckParams | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  // Set while an answer is being written. A second tap during the await would otherwise rate the
  // same card again from its old state and log two reviews for one answer.
  const answering = useRef(false);

  useEffect(() => {
    (async () => {
      const [c, n, today, allParams] = await Promise.all([
        repo.listCards(deck), repo.listNotes(), repo.studiedToday(deck, new Date(), DAY_STARTS_AT_HOUR), repo.listDeckParams(),
      ]);
      setParams(paramsForDeck(deck, allParams));
      setCards(c);
      setNotes(new Map(n.map((x) => [x.id, x])));
      setStudied(today);
    })();
  }, [repo, deck]);

  const queue = useMemo(
    () => (cards ? buildQueue(cards, queueOptionsFor(params, studied, { ...STUDY_DEFAULTS, now })) : null),
    [cards, studied, params, now],
  );
  const current = queue ? nextCard(queue) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  const rendered = current && note ? renderCard(note, current.kind) : undefined;
  const intervals = current && revealed ? previewIntervals(current.sched, now, params) : undefined;

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
    if (!current || answering.current) return;
    answering.current = true;
    try {
      const when = new Date();
      const res = review(current.sched, rating, when, params);
      const updated: Card = { ...current, sched: res.sched };
      await repo.saveCard(updated);
      await repo.addReview({ cardId: current.id, ...res.log });
      const before = current.sched.state;
      if (before === 0 || before === 2) {
        setStudied((s) => ({
          introduced: s.introduced + (before === 0 ? 1 : 0),
          reviewed: s.reviewed + (before === 2 ? 1 : 0),
        }));
      }
      // Functional update: `cards` from this render's closure is stale once the awaits return.
      setCards((prev) => prev && prev.map((c) => (c.id === updated.id ? updated : c)));
      setRevealed(false);
      setNow(when);
    } finally {
      answering.current = false;
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

  if (!current || !rendered) {
    const minutes = waitingFor ? Math.max(1, Math.ceil((waitingFor.getTime() - Date.now()) / 60000) - LEARN_AHEAD_MINUTES) : 0;
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Text style={{ color: t.text, fontSize: 22 }}>{waitingFor ? 'Nothing due right now' : 'All done for now 🎉'}</Text>
        {waitingFor ? (
          <Text style={{ color: t.sub }}>The next card comes back in about {minutes} min.</Text>
        ) : null}
        <Pressable onPress={onDone} style={{ backgroundColor: t.accent, borderRadius: 12, paddingHorizontal: 28, paddingVertical: 12 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Back to decks</Text>
        </Pressable>
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 }}>
        <Pressable onPress={onDone}><Text style={{ color: t.accent, fontSize: 16 }}>‹ Decks</Text></Pressable>
        <Text style={{ color: t.sub }}>{queue!.due.length} due · {queue!.fresh.length} new</Text>
      </View>
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
            onPress={() => { setRevealed(true); if (rendered.back.speak) speak(rendered.back.speak); }}
            style={{ backgroundColor: t.accent, borderRadius: 14, padding: 16, alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Show answer</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
