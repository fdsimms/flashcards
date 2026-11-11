import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { renderCard } from '../core/cards';
import { buildQueue, nextCard } from '../core/queue';
import { previewIntervals, review, type RatingValue } from '../core/scheduler';
import type { Card, Note, RenderedSide } from '../core/types';
import type { Repo } from '../db/repo';
import { useTheme } from './theme';

const NEW_PER_DAY = 20;

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
  const [introduced, setIntroduced] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    (async () => {
      const [c, n, intro] = await Promise.all([repo.listCards(deck), repo.listNotes(), repo.newIntroducedToday(deck, new Date())]);
      setCards(c);
      setNotes(new Map(n.map((x) => [x.id, x])));
      setIntroduced(intro);
    })();
  }, [repo, deck]);

  const queue = useMemo(
    () => (cards ? buildQueue(cards, { newPerDay: NEW_PER_DAY, newIntroducedToday: introduced, now }) : null),
    [cards, introduced, now],
  );
  const current = queue ? nextCard(queue) : undefined;
  const note = current ? notes.get(current.noteId) : undefined;
  const rendered = current && note ? renderCard(note, current.kind) : undefined;
  const intervals = current && revealed ? previewIntervals(current.sched, now) : undefined;

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
    if (!current || !cards) return;
    const when = new Date();
    const res = review(current.sched, rating, when);
    const updated: Card = { ...current, sched: res.sched };
    await repo.saveCard(updated);
    await repo.addReview({ cardId: current.id, ...res.log });
    if (current.sched.state === 0) setIntroduced((n) => n + 1);
    setCards(cards.map((c) => (c.id === current.id ? updated : c)));
    setRevealed(false);
    setNow(when);
  };

  if (!cards) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  if (!current || !rendered) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <Text style={{ color: t.text, fontSize: 22 }}>All done for now 🎉</Text>
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
