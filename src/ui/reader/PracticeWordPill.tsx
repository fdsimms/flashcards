import React from 'react';
import { Text, View } from 'react-native';
import type { Word } from '../../reader/api';
import { haptic } from '../haptics';
import { Tappable } from '../kit';
import { radius, space, type, useTheme } from '../theme';

/**
 * A practice word as a pill: bold gold on a gold tint, the same in the reader and on a story's
 * banner and page. With `onPress` it opens the word's meaning (given where it was tapped, to place the
 * popover); without, a server that sent no practice words, it's only shown.
 */
export function PracticeWordPill({ word, onPress }: { word: string; onPress?: (x: number, y: number) => void }) {
  const c = useTheme();
  const pill = <TintPill text={word} bg={c.accentFill} fg={c.accentInk} />;
  if (!onPress) return pill;
  return (
    <Tappable
      onPress={(e) => { haptic.tap(); onPress(e.nativeEvent.pageX, e.nativeEvent.pageY); }}
      accessibilityRole="button"
      accessibilityLabel={`Meaning of ${word}`}
      // The pill is shorter than a full tap target; this makes up the rest.
      hitSlop={{ top: space.m, bottom: space.m }}
    >
      {pill}
    </Tappable>
  );
}

/**
 * The next episode's practice words under a "Practice words" label, so a bare word on a story's
 * banner or page says what it is. Each pill opens its meaning when the server sent the word's
 * details (`practice`); a server older than that sends none, and the pills are only shown.
 */
export function PracticeWordRow({ words, practice, onTap }: {
  words: string[];
  practice?: Word[];
  onTap: (word: Word, x: number, y: number) => void;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6, paddingTop: space.xs }}>
      <Text style={{ ...type.footnote, fontWeight: '600', color: c.textSecondary }}>Practice words</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {words.map((w) => {
          const word = practice?.find((p) => p.text === w);
          return <PracticeWordPill key={w} word={w} onPress={word ? (x, y) => onTap(word, x, y) : undefined} />;
        })}
      </View>
    </View>
  );
}

/** The pill's shape in any pair of colors: the reader's grammar points use it in speaker B's. */
export function TintPill({ text, bg, fg }: { text: string; bg: string; fg: string }) {
  return (
    <Text style={{ ...type.subhead, fontWeight: '700', color: fg, backgroundColor: bg, paddingHorizontal: 10, paddingVertical: space.xs, borderRadius: radius.pill, overflow: 'hidden' }}>
      {text}
    </Text>
  );
}
