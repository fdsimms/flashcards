import React from 'react';
import { useApp } from '../ui/AppContext';
import { SchedulingSettings } from '../ui/SchedulingSettings';

/** Settings > Decks and cards > Scheduling: Anki's collection-wide scheduling preferences. */
export default function SchedulingRoute() {
  const { repo, refresh } = useApp();
  return <SchedulingSettings repo={repo} onSaved={() => void refresh()} />;
}
