import React, { useState } from 'react';
import { deckCardFonts } from '../core/deckTree';
import { availableFonts, isAvailable } from '../core/fontDownloads';
import { CYCLE_FONTS, deckFontMode, fontCovers, fontsCovering, missingScripts, poolForMode, SCRIPT_NAMES, togglePoolFont, type DeckFontMode, type Script } from '../core/fonts';
import { useFontSettings } from './AppFont';
import type { DeckSettings } from '../core/types';
import { FontRow } from './FontRows';
import { Group, Help, Section, Segments } from './kit';

/**
 * Deck options for the font a deck's cards are set in. "Deck font" fixes one font for the deck's cards.
 * "Randomize" gives every card one of the checked fonts for the session (`cardFontFor`), so the same word
 * is seen in different type from one session to the next. Both apply to the deck and its subdecks unless
 * a subdeck sets its own, and the app's font doesn't apply to these cards. Both are saved as `cardFonts`,
 * so a list of one is a fixed font; `randomizing` keeps Randomize shown while only one font is checked.
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
  const [randomizing, setRandomizing] = useState(false);
  const mode: DeckFontMode = pool.length === 0 ? 'app' : randomizing ? 'random' : deckFontMode(pool);
  const covering = availableFonts(fontsCovering(scripts), installed);
  // Fonts that would cover the deck once downloaded (Settings, Font).
  const coveringNotDownloaded = fontsCovering(scripts).length > covering.length;
  const blocked = covering.length === 0 && pool.length === 0;
  const need = scripts.map((x) => SCRIPT_NAMES[x]).join(' and ');
  return (
    <Section
      title="Card fonts"
      footer={(
        <Help>
          {mode === 'random'
            ? `Each card gets one of the checked fonts instead of the app font, and keeps it until you start another review session. ${need ? `Fonts that can't draw ${need} are dimmed. ` : ''}Applies to this deck and its subdecks, unless a subdeck sets its own.`
            : mode === 'deck'
            ? `Every card in this deck uses the selected font instead of the app font. ${need ? `Fonts that can't draw ${need} are dimmed. ` : ''}Applies to this deck and its subdecks, unless a subdeck sets its own.`
            : covering.length === 0
              ? coveringNotDownloaded
                ? `Download a font that covers ${need} in Settings, Font to set this deck's font. Until then it uses the app font, unless its card template sets one.`
                : `No font covers ${need}, so this deck can't use its own font. It uses the app font (Settings, Font), unless its card template sets one.`
              : "Cards in this deck use the app font (Settings, Font), unless their card template sets one."}
        </Help>
      )}
    >
      <Segments<DeckFontMode>
        options={[{ value: 'app', label: 'App font' }, { value: 'deck', label: 'Deck font', disabled: blocked }, { value: 'random', label: 'Randomize', disabled: blocked }]}
        value={mode}
        onChange={(v) => {
          setRandomizing(v === 'random');
          onChange({ cardFonts: poolForMode(v, pool, covering) });
        }}
      />
      {mode !== 'app' ? (
        <Group accessibilityRole={mode === 'deck' ? 'radiogroup' : 'list'}>
          {CYCLE_FONTS.map((id, i) => (
            <FontRow
              key={id}
              id={id}
              first={i === 0}
              detail={mode === 'deck'}
              choice={mode === 'deck' ? 'one' : 'many'}
              selected={pool.includes(id)}
              unavailable={pool.includes(id) ? undefined : !fontCovers(id, scripts) ? `No ${missingScripts(id, scripts).map((x) => SCRIPT_NAMES[x]).join(' or ')}` : !isAvailable(id, installed) ? 'Not downloaded. Download it in Settings, Font.' : undefined}
              onPress={() => onChange({ cardFonts: mode === 'deck' ? [id] : togglePoolFont(pool, id) })}
            />
          ))}
        </Group>
      ) : null}
    </Section>
  );
}
