import React from 'react';
import { Text, View } from 'react-native';
import { runwayText, type LowDeck } from '../reader/newWords';
import { deckShortName } from './deckShortName';
import { Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { hairline, lift, radius, smooth, space, type, useTheme } from './theme';
import { useNewWords } from './useNewWords';

/**
 * Today's card for each language deck running low on new cards (useNewWords): how many days are
 * left, and a tap opens Suggested words. The x hides it until the next study day.
 */
export function NewWordsCards() {
  const { low, dismiss, open } = useNewWords();
  return <>{low.map((d) => <NewWordsCard key={d.deck} deck={d} onOpen={() => open(d)} onDismiss={() => dismiss(d.deck)} />)}</>;
}

function NewWordsCard({ deck, onOpen, onDismiss }: { deck: LowDeck; onOpen: () => void; onDismiss: () => void }) {
  const c = useTheme();
  const message = `${deckShortName(deck.deck)}: ${runwayText(deck.left, deck.perDay)}`;
  const hint = 'Tap to pick new words to add';
  return (
    <Reveal
      style={{
        flexDirection: 'row', alignItems: 'center', borderRadius: radius.l, ...smooth,
        backgroundColor: c.surface, borderColor: c.border, borderWidth: hairline, ...lift(c, 'high'),
      }}
    >
      <Tappable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${message}. ${hint}`}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingLeft: space.l }}
      >
        <Icon name="plus.circle.fill" size={22} color={c.teal} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.callout, color: c.text }}>{message}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{hint}</Text>
        </View>
      </Tappable>
      <Tappable
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss until tomorrow"
        style={{ width: 44, height: 44, marginRight: space.xs, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="xmark" size={14} color={c.textSecondary} />
      </Tappable>
    </Reveal>
  );
}
