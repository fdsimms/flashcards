import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { DEFAULT_LISTEN_COUNT, LISTEN_COUNTS, LISTEN_MIN, listenMinutes, listenSummary, type ListenCount } from '../../core/listenWords';
import { ApiError, type Api, type Language } from '../../reader/api';
import { Button, Card, ErrorNote, Segments, Tag } from '../kit';
import { space, type, useTheme } from '../theme';
import { useListenWords } from '../useListenWords';

/**
 * Your words on the Lessons tab, beside Lines from your reading (docs/read-and-listen/architecture.md,
 * "Your words"): the deck's words due today, then the ones started in the last two weeks, made into
 * a lesson to hear with the screen locked. Each word, a pause to recall it, its meaning and an
 * example; or Meaning first. Asked for here and made in the background like any lesson, then in the
 * list to play. Nothing here rates or changes a card.
 */
export function YourWordsCard({ api, language, deck, narrator, particle, onMade }: {
  api: Api;
  language: Language;
  /** The language's deck (Read & Listen's setting), which the words come from. */
  deck: string;
  narrator?: string;
  particle?: 'khrap' | 'kha';
  onMade: () => Promise<unknown>;
}) {
  const c = useTheme();
  const [count, setCount] = useState<ListenCount>(DEFAULT_LISTEN_COUNT);
  const [meaningFirst, setMeaningFirst] = useState(false);
  const { words, reload } = useListenWords(deck, count);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!words || words.length < LISTEN_MIN) return null;

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.makeYourWords(language, words, meaningFirst, narrator, particle);
      await onMade();
      reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't ask for the lesson. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s }}>
        <Text style={{ ...type.headline, color: c.text, flex: 1 }}>Your words</Text>
        <Tag text={`${listenMinutes(words)} min`} color={c.accentInk} fill={c.accentFill} />
      </View>
      <Text style={{ ...type.subhead, color: c.textSecondary }}>
        {`${words.length} words: ${listenSummary(words)}. ${meaningFirst ? 'Each meaning in English, a pause to say the word, then the word and an example.' : 'Each word, a pause to recall it, then its meaning and an example.'}`}
      </Text>
      <Segments<'word' | 'meaning'>
        options={[{ value: 'word', label: 'Word first' }, { value: 'meaning', label: 'Meaning first' }]}
        value={meaningFirst ? 'meaning' : 'word'}
        onChange={(v) => setMeaningFirst(v === 'meaning')}
      />
      <Segments<`${ListenCount}`>
        options={LISTEN_COUNTS.map((n) => ({ value: `${n}` as `${ListenCount}`, label: `Up to ${n}` }))}
        value={`${count}`}
        onChange={(v) => setCount(Number(v) as ListenCount)}
      />
      <Button label="Make the lesson" onPress={make} busy={busy} />
      {error ? <ErrorNote message={error} /> : null}
    </Card>
  );
}
