import { useSyncExternalStore } from 'react';
import { syncProgress, type SyncProgress } from '../anki/sync/progress';

/** What the sync running now reports (src/anki/sync/progress.ts), or null when none is running. Read from the store, not AppContext, so a count ticking doesn't render every screen. */
export function useSyncProgress(): SyncProgress | null {
  return useSyncExternalStore(syncProgress.subscribe, syncProgress.get);
}
