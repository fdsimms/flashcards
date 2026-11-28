import React from 'react';
import type { GlossLanguage } from '../../reader/api';
import { deckOf, glossInfo } from '../../reader/languages';
import { reviewFirst } from '../../reader/reviewFirst';
import { useApp } from '../AppContext';
import { Banner } from '../kit';
import { Reveal } from '../motion';
import { type, useTheme } from '../theme';

/**
 * The shelf's row while the language's deck has reviews due (`reviewFirst`): a word due today and
 * not reviewed yet is left out of new texts, so reviewing first gives them more of your words. It
 * opens the deck's review and hides itself once nothing is due. The same shape as the deck list's
 * note queue card.
 */
export function ReadReviewFirst({ language, onReview }: { language: GlossLanguage; onReview: (deck: string) => void }) {
  const c = useTheme();
  const { decks, reader } = useApp();
  const due = reviewFirst(deckOf(reader.settings, language), glossInfo(language).name, decks);
  if (!due) return null;
  return (
    <Reveal>
      <Banner icon="rectangle.stack" iconColor={c.countDue} title={due.message} hint={due.hint} onPress={() => onReview(due.deck)} />
    </Reveal>
  );
}
