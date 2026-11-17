import React from 'react';
import { View } from 'react-native';
import { deckCardFonts } from '../core/deckTree';
import { CYCLE_FONTS, togglePoolFont } from '../core/fonts';
import type { DeckSettings } from '../core/types';
import { FontRow } from './FontRows';
import { Group, Help, SectionTitle, Segments } from './kit';
import { space } from './theme';

/**
 * Deck options for the font a deck's cards are set in. "Change each session" gives every card one of the
 * checked fonts for the session (`cardFontFor`), so the same word is seen in different type from one
 * session to the next. It applies to the deck and its subdecks unless a subdeck sets its own, and the
 * app's font doesn't apply to these cards.
 */
export function DeckFontOptions({ deck, all, onChange }: {
  deck: string;
  /** Every deck's settings, this deck's as it is now. */
  all: Map<string, DeckSettings>;
  onChange: (patch: DeckSettings) => void;
}) {
  const pool = deckCardFonts(deck, all);
  const cycling = pool.length > 0;
  return (
    <>
      <View style={{ gap: space.s }}>
        <SectionTitle>Card fonts</SectionTitle>
        <Segments<'app' | 'cycle'>
          options={[{ value: 'app', label: 'App font' }, { value: 'cycle', label: 'Change each session' }]}
          value={cycling ? 'cycle' : 'app'}
          onChange={(v) => onChange({ cardFonts: v === 'cycle' ? CYCLE_FONTS : [] })}
        />
      </View>
      {cycling ? (
        <Group accessibilityRole="list">
          {CYCLE_FONTS.map((id, i) => (
            <FontRow key={id} id={id} first={i === 0} choice="many" selected={pool.includes(id)} onPress={() => onChange({ cardFonts: togglePoolFont(pool, id) })} />
          ))}
        </Group>
      ) : null}
      <Help>
        {cycling
          ? 'Each card gets one of the checked fonts, and keeps it until you start another review session. These cards ignore the app font. Applies to this deck and its subdecks, unless a subdeck sets its own.'
          : "Cards in this deck use the app font (Settings, Font), or the font the deck's own template sets."}
      </Help>
    </>
  );
}
