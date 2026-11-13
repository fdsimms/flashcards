import React from 'react';
import { Text, View } from 'react-native';
import type { Language } from '../reader/api';
import { LANGUAGES } from '../reader/languages';
import { reviewFirst } from '../reader/reviewFirst';
import { useApp } from './AppContext';
import { haptic } from './haptics';
import { Icon, Tappable } from './kit';
import { Reveal } from './motion';
import { lift, radius, smooth, space, type, useTheme } from './theme';

/**
 * The shelf's card while the language's deck has reviews due (`reviewFirst`): a word due today and
 * not reviewed yet is left out of new texts, so reviewing first gives them more of your words. It
 * opens the deck's review and hides itself once nothing is due. The same shape as the deck list's
 * note queue card.
 */
export function ReadReviewFirst({ language, onReview }: { language: Language; onReview: (deck: string) => void }) {
  const c = useTheme();
  const { decks, reader } = useApp();
  const due = reviewFirst(reader.settings?.decks[language], LANGUAGES[language].name, decks);
  if (!due) return null;
  return (
    <Reveal>
      <Tappable
        onPress={() => { haptic.tap(); onReview(due.deck); }}
        accessibilityRole="button"
        accessibilityLabel={`${due.message}. ${due.hint}`}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 56, paddingVertical: space.m, paddingHorizontal: space.l,
          borderRadius: radius.l, ...smooth, backgroundColor: c.surface, borderColor: c.border, borderWidth: 0.5, ...lift(c, 'high'),
        }}
      >
        <Icon name="rectangle.stack" size={22} color={c.countDue} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.callout, color: c.text }}>{due.message}</Text>
          <Text style={{ ...type.footnote, color: c.textSecondary }}>{due.hint}</Text>
        </View>
        <Icon name="chevron.right" size={14} color={c.textTertiary} weight="semibold" />
      </Tappable>
    </Reveal>
  );
}
