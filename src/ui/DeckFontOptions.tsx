import React from 'react';
import { View } from 'react-native';
import { deckCardFonts } from '../core/deckTree';
import { availableFonts, isAvailable } from '../core/fontDownloads';
import { CYCLE_FONTS, fontCovers, fontsCovering, missingScripts, SCRIPT_NAMES, togglePoolFont, type Script } from '../core/fonts';
import { useFontSettings } from './AppFont';
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
export function DeckFontOptions({ deck, all, scripts, onChange }: {
  deck: string;
  /** The scripts the deck's cards are written in (`deckScripts`); a font that can't draw them is dimmed. */
  scripts: Script[];
  /** Every deck's settings, this deck's as it is now. */
  all: Map<string, DeckSettings>;
  onChange: (patch: DeckSettings) => void;
}) {
  const { installed } = useFontSettings();
  const pool = deckCardFonts(deck, all);
  const cycling = pool.length > 0;
  const covering = availableFonts(fontsCovering(scripts), installed);
  // Fonts that would cover the deck once downloaded (Settings, Font).
  const coveringNotDownloaded = fontsCovering(scripts).length > covering.length;
  const need = scripts.map((x) => SCRIPT_NAMES[x]).join(' and ');
  return (
    <>
      <View style={{ gap: space.s }}>
        <SectionTitle>Card fonts</SectionTitle>
        <Segments<'app' | 'cycle'>
          options={[{ value: 'app', label: 'App font' }, { value: 'cycle', label: 'Change each session', disabled: covering.length === 0 && !cycling }]}
          value={cycling ? 'cycle' : 'app'}
          onChange={(v) => onChange({ cardFonts: v === 'cycle' ? covering : [] })}
        />
      </View>
      {cycling ? (
        <Group accessibilityRole="list">
          {CYCLE_FONTS.map((id, i) => (
            <FontRow
              key={id}
              id={id}
              first={i === 0}
              choice="many"
              selected={pool.includes(id)}
              unavailable={pool.includes(id) ? undefined : !fontCovers(id, scripts) ? `No ${missingScripts(id, scripts).map((x) => SCRIPT_NAMES[x]).join(' or ')}` : !isAvailable(id, installed) ? 'Not downloaded. Download it in Settings, Font.' : undefined}
              onPress={() => onChange({ cardFonts: togglePoolFont(pool, id) })}
            />
          ))}
        </Group>
      ) : null}
      <Help>
        {cycling
          ? `Each card gets one of the checked fonts, and keeps it until you start another review session. These cards ignore the app font. ${need ? `Fonts that can't draw ${need} are dimmed. ` : ''}Applies to this deck and its subdecks, unless a subdeck sets its own.`
          : covering.length === 0
            ? coveringNotDownloaded
              ? `Download a font that covers ${need} in Settings, Font to change this deck's fonts. Until then it uses the app font, or the font the deck's own template sets.`
              : `No font covers ${need}, so this deck can't change fonts. It uses the app font (Settings, Font), or the font the deck's own template sets.`
            : "Cards in this deck use the app font (Settings, Font), or the font the deck's own template sets."}
      </Help>
    </>
  );
}
