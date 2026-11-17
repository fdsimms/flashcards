import React from 'react';
import { waitingLines } from '../core/held';
import { useApp } from '../ui/AppContext';
import { useConnectionProblem } from '../ui/connection';
import { useHeldReader, useHeldRecordings, useHeldWords } from '../ui/held';
import { OfflineSheet } from '../ui/OfflineSheet';

/** What's waiting for the connection, opened from any screen's Offline button. */
export default function OfflineRoute() {
  const { ankiUnsent, wanikani } = useApp();
  const problem = useConnectionProblem();
  const words = useHeldWords().reduce((n, g) => n + g.entries.length, 0);
  const recordings = useHeldRecordings().length;
  const readings = useHeldReader().filter((a) => a.kind === 'reading').length;
  return <OfflineSheet problem={problem} lines={waitingLines({ answers: ankiUnsent, wanikani: wanikani.unsent, words, recordings, readings })} />;
}
