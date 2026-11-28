import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { lessonRequestWords, type LessonWord } from '../../core/lessonWords';
import { ApiError, type Api, type Language } from '../../reader/api';
import { haptic } from '../haptics';
import { ErrorNote, Tappable, TextButton } from '../kit';
import { radius, space, type, useTheme } from '../theme';

/**
 * The New lesson card's "Suggest topics": Claude writes a few scenes (fitted to the words chosen,
 * and never one already made as a lesson), and tapping one fills the scene field. Nothing is
 * asked for until Make a lesson, and the ideas are dropped when the language or the words change,
 * since they were written for those.
 */
export function LessonTopics({ api, language, words, onPick }: {
  api: Api;
  language: Language;
  words: LessonWord[];
  onPick: (topic: string) => void;
}) {
  const c = useTheme();
  const [topics, setTopics] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every idea offered so far, so asking again gives different ones.
  const shown = useRef<string[]>([]);
  // What the ideas were written for. A reply that lands after it changed belongs to nothing on screen.
  const wordsKey = words.map((w) => w.text).join('\n');
  const askedFor = `${language}\n${wordsKey}`;
  const current = useRef(askedFor);
  current.current = askedFor;

  useEffect(() => {
    setTopics([]);
    setError(null);
    shown.current = [];
  }, [askedFor]);

  const ask = async () => {
    if (asking) return;
    const forNow = askedFor;
    setAsking(true);
    setError(null);
    try {
      const ideas = await api.lessonTopics(language, words.length ? lessonRequestWords(words) : undefined, shown.current);
      if (current.current !== forNow) return;
      shown.current = [...shown.current, ...ideas];
      setTopics(ideas);
    } catch (e) {
      if (current.current !== forNow) return;
      setError(e instanceof ApiError ? e.message : "Couldn't get ideas. Try again.");
    } finally {
      setAsking(false);
    }
  };

  const pick = (topic: string) => {
    haptic.tap();
    onPick(topic);
    setTopics([]);
  };

  return (
    <View style={{ gap: space.s }}>
      {topics.length ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
            {topics.map((t) => (
              <Tappable
                key={t}
                onPress={() => pick(t)}
                accessibilityRole="button"
                accessibilityLabel={`Use ${t}`}
                scaleTo={0.95}
                style={{ borderWidth: 1, borderColor: c.controlEdge, borderRadius: radius.pill, paddingVertical: space.s, paddingHorizontal: space.m }}
              >
                <Text style={{ ...type.subhead, color: c.text }}>{t}</Text>
              </Tappable>
            ))}
          </View>
          <TextButton label="More ideas" busy={asking} busyLabel="Thinking of ideas" onPress={() => void ask()} style={{ alignSelf: 'flex-end' }} />
        </>
      ) : (
        <TextButton icon="sparkles" label="Suggest topics" busy={asking} busyLabel="Thinking of ideas" onPress={() => void ask()} style={{ alignSelf: 'flex-start' }} />
      )}
      {error ? <ErrorNote message={error} onRetry={ask} /> : null}
    </View>
  );
}
