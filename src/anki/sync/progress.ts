/**
 * What a running sync reports as it goes, for the Sync screen's status line and bar: which phase it
 * is in and, where the work is countable, how far along. Pure, so the sequence a sync reports is
 * tested (`runSync.test.ts`, `mediaSync.test.ts`). Nothing here reaches the network or a file.
 */
export type SyncProgress =
  | { phase: 'collection' }
  | { phase: 'download'; bytes: number }
  | { phase: 'upload' }
  /** The server's media changes, counted in the server's own change numbers (`mediaChanges`), so `total` is known up front. */
  | { phase: 'media'; done: number; total: number }
  /** Files made here, being sent. */
  | { phase: 'mediaSend'; done: number; total: number };

const MB = 1024 * 1024;

const count = (n: number) => n.toLocaleString('en-US');

/** The status line while a sync runs, in the app's plain words. */
export function progressText(p: SyncProgress): string {
  switch (p.phase) {
    case 'collection': return 'Syncing your collection.';
    case 'download': return p.bytes >= MB ? `Downloading your collection, ${p.bytes >= 10 * MB ? Math.round(p.bytes / MB) : (p.bytes / MB).toFixed(1)} MB.` : 'Downloading your collection.';
    case 'upload': return 'Sending your collection to the server.';
    case 'media': return `Syncing images and sounds, ${count(p.done)} of ${count(p.total)}.`;
    case 'mediaSend': return `Sending images and sounds, ${count(p.done)} of ${count(p.total)}.`;
  }
}

/** How far along, 0 to 1, where a total is known. A download has none (the server doesn't say its size), and a made-up percentage is worse than none. */
export function progressFraction(p: SyncProgress): number | undefined {
  if (p.phase !== 'media' && p.phase !== 'mediaSend') return undefined;
  return p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : undefined;
}

/**
 * Passes progress on at most every `ms` within one phase, so a thousand-file sync doesn't redraw the
 * screen a thousand times. A new phase and the last count of a phase always go through at once.
 */
export function throttledProgress(emit: (p: SyncProgress) => void, ms = 250, now: () => number = Date.now): (p: SyncProgress) => void {
  let last: SyncProgress | undefined;
  let at = 0;
  return (p) => {
    const finished = (p.phase === 'media' || p.phase === 'mediaSend') && p.done >= p.total;
    if (last && last.phase === p.phase && !finished && now() - at < ms) return;
    last = p;
    at = now();
    emit(p);
  };
}

/** The progress of the sync running now, for any screen to show (one for the app, like `collectionChanged`). `null` when none is running. */
export function progressStore() {
  let value: SyncProgress | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): SyncProgress | null => value,
    set(next: SyncProgress | null): void {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const syncProgress = progressStore();
