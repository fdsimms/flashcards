import React from 'react';
import { runwayText, type LowDeck } from '../reader/newWords';
import { deckShortName } from './deckShortName';
import { Banner } from './kit';
import { Reveal, useLeaveAnimation } from './motion';
import { type, useTheme } from './theme';
import { useNewWords } from './useNewWords';

/**
 * Today's card for each language deck running low on new cards (useNewWords): how many days are
 * left, and a tap opens Suggested words. The x hides it until the next study day.
 */
export function NewWordsCards() {
  const { low, dismiss, open } = useNewWords();
  useLeaveAnimation(low.length);
  return <>{low.map((d) => <NewWordsCard key={d.deck} deck={d} onOpen={() => open(d)} onDismiss={() => dismiss(d.deck)} />)}</>;
}

function NewWordsCard({ deck, onOpen, onDismiss }: { deck: LowDeck; onOpen: () => void; onDismiss: () => void }) {
  const c = useTheme();
  const message = `${deckShortName(deck.deck)}: ${runwayText(deck.left, deck.perDay)}`;
  const hint = 'Tap to pick new words to add';
  return (
    <Reveal>
      <Banner icon="plus.circle.fill" iconColor={c.teal} title={message} hint={hint} onPress={onOpen} onDismiss={onDismiss} dismissLabel="Dismiss until tomorrow" />
    </Reveal>
  );
}
