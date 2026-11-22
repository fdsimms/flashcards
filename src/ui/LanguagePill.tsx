import React from 'react';
import { Text, View } from 'react-native';
import { radius, smooth, space, type, useTheme } from './theme';

/** Which language a card in a deck that mixes several belongs to: the subdeck's emoji and name, and its tint (`deckTint`, as on the deck list). */
export interface CardLanguage {
  emoji: string | null;
  name: string;
  /** A color from the theme's `deckTints`, washed over the card. */
  wash: string;
}

/** The language's name at the top of the card, in a pill on its tint. */
export function LanguagePill({ language }: { language: CardLanguage }) {
  const c = useTheme();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: space.m, left: 0, right: 0, alignItems: 'center' }}>
      {/* The wash is translucent, so it sits on the card's own surface color: otherwise a long prompt shows through the pill and runs into its text. */}
      <View
        accessible
        accessibilityLabel={`${language.name} card`}
        style={{ borderRadius: radius.pill, ...smooth, overflow: 'hidden', backgroundColor: c.surface }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, paddingHorizontal: space.m, paddingVertical: space.xs, backgroundColor: language.wash }}>
          {language.emoji ? <Text allowFontScaling={false} style={{ fontSize: 13 }}>{language.emoji}</Text> : null}
          <Text style={{ ...type.overline, color: c.text }}>{language.name}</Text>
        </View>
      </View>
    </View>
  );
}
