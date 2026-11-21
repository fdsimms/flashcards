import React from 'react';
import { NEW_PER_DAY, REVIEWS_PER_DAY } from '../core/config';
import type { DeckSettings } from '../core/types';
import { haptic } from './haptics';
import { Help, SectionTitle, Segments } from './kit';

const NEW_CHOICES = [5, 10, 20, 30, 50];
const REVIEW_CHOICES = [100, 200, 500, 9999];

/**
 * Daily limits for a deck with no Anki options preset to keep them (one made in Franki with no Anki
 * collection): kept in Franki (`DeckSettings.newPerDay` / `reviewsPerDay`) and read by the queue through
 * `queueInput`'s `ownLimitsFor`. A deck with a preset sets them in Anki options instead.
 */
export function DeckDailyLimits({ settings, onChange }: { settings: DeckSettings; onChange: (patch: Partial<DeckSettings>) => void }) {
  const fresh = settings.newPerDay ?? NEW_PER_DAY;
  const reviews = settings.reviewsPerDay ?? REVIEWS_PER_DAY;
  return (
    <>
      <SectionTitle>New cards a day</SectionTitle>
      <Segments
        options={[...new Set([...NEW_CHOICES, fresh])].sort((a, b) => a - b).map((n) => ({ value: n, label: String(n) }))}
        value={fresh}
        onChange={(newPerDay) => { haptic.select(); onChange({ newPerDay }); }}
      />
      <SectionTitle>Most reviews a day</SectionTitle>
      <Segments
        options={[...new Set([...REVIEW_CHOICES, reviews])].sort((a, b) => a - b).map((n) => ({ value: n, label: n >= 9999 ? 'No limit' : String(n), ...(n >= 9999 ? { accessibilityLabel: 'No limit' } : {}) }))}
        value={reviews}
        onChange={(reviewsPerDay) => { haptic.select(); onChange({ reviewsPerDay }); }}
      />
      <Help>
        New cards are the words you haven't studied yet. Each one you learn comes back for reviews, so more new cards a day
        means more reviews in the weeks after. These are kept in Franki, since this deck isn't in an Anki collection.
      </Help>
    </>
  );
}
