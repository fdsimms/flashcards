import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { cardHomeDeck } from '../core/deckTree';
import { paramsForDeck } from '../core/scheduler';
import type { Card, DeckParams, Note } from '../core/types';
import { wordsKnown, wordsLine } from '../core/wordsKnown';
import { Card as Box, Help } from './kit';
import { radius, space, type, useTheme } from './theme';

/**
 * Words you know, on Stats (src/core/wordsKnown.ts): each language's estimate of the words that
 * would be remembered today, a bar of its mature and its younger studied words out of all the
 * words in its decks, and the counts under it. `cards` are the ones Stats has in view, so a deck
 * picked there narrows this too. Nothing shows when no card in view is a word in a language.
 */
export function WordsKnown({ notes, cards, params, now }: { notes: Note[]; cards: Card[]; params: Map<string, DeckParams>; now: Date }) {
  const c = useTheme();
  const languages = useMemo(() => wordsKnown({
    notes, cards, now,
    // Each card is forgotten at its own deck's rate, as Card info works it out.
    weightsOf: (card, note) => paramsForDeck(cardHomeDeck(card, note.deck), params)?.weights ?? [],
  }), [notes, cards, params, now]);
  if (!languages.length) return null;
  return (
    <Box>
      <Text accessibilityRole="header" style={{ ...type.headline, color: c.text }}>Words you know</Text>
      {languages.map((l) => (
        <View key={l.tag} accessible accessibilityLabel={`${l.name}: about ${l.estimate.toLocaleString()} words. ${wordsLine(l).replace(/ · /g, ', ')}`} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.m }}>
            <Text style={{ ...type.body, color: c.text, flexShrink: 1 }}>{l.name}</Text>
            <Text style={{ ...type.title, color: c.text, fontVariant: ['tabular-nums'] }}>{`about ${l.estimate.toLocaleString()}`}</Text>
          </View>
          <View style={{ flexDirection: 'row', height: space.s, borderRadius: radius.pill, backgroundColor: c.fill, overflow: 'hidden' }}>
            <View style={{ width: `${(l.mature / l.words) * 100}%`, backgroundColor: c.chart }} />
            <View style={{ width: `${((l.studied - l.mature) / l.words) * 100}%`, backgroundColor: c.chart, opacity: 0.45 }} />
          </View>
          <Text style={{ ...type.footnote, color: c.textSecondary, fontVariant: ['tabular-nums'] }}>{wordsLine(l)}</Text>
        </View>
      ))}
      <Help>A word is a note in a language's decks. "About" adds up how likely each studied word is to be remembered today, going by its best-known card. Skill cards and suspended cards aren't counted.</Help>
    </Box>
  );
}
