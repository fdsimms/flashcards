import React from 'react';
import { inheritedSetting } from '../core/deckTree';
import type { DeckSettings } from '../core/types';
import { Group, Help, Section, SwitchRow } from './kit';

/**
 * Deck options for studying a deck's subdecks one at a time (`DeckSettings.batchBySubdeck`). It
 * applies to the deck and its subdecks unless a subdeck sets its own.
 */
export function DeckBatchOptions({ deck, all, onChange }: {
  deck: string;
  /** Every deck's settings, this deck's as it is now. */
  all: Map<string, DeckSettings>;
  onChange: (patch: DeckSettings) => void;
}) {
  return (
    <Section
      title="Subdecks"
      footer={(
        <Help>
            When you study this deck, reviews and new cards come one subdeck at a time (e.g. all of Polish, then all of Thai),
            in name order. Cards you missed and are learning again still come back whenever they're due.
        </Help>
      )}
    >
      <Group>
        <SwitchRow first label="Study one subdeck at a time" value={inheritedSetting(deck, all, 'batchBySubdeck') ?? false} onValueChange={(v) => onChange({ batchBySubdeck: v })} />
      </Group>
    </Section>
  );
}
