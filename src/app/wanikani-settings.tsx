import React from 'react';
import { useApp } from '../ui/AppContext';
import { WaniKaniSettings } from '../ui/WaniKaniSettings';

/** Turning WaniKani on (its token) or off, and its options. */
export default function WaniKaniSettingsRoute() {
  const { wanikani, decks } = useApp();
  // Top-level and subdecks alike: a production deck is usually a language's subdeck.
  return <WaniKaniSettings wanikani={wanikani} decks={decks.map((d) => d.deck)} />;
}
