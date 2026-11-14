import React from 'react';
import { useApp } from '../ui/AppContext';
import { SpeakingSettings } from '../ui/SpeakingSettings';

/** Settings > Speaking: Answer by speaking, and the languages this iPhone can hear. */
export default function SpeakingRoute() {
  const { repo } = useApp();
  return <SpeakingSettings repo={repo} />;
}
