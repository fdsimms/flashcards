import type { Language, VocabBank } from './api';

/**
 * A vocabulary check whose questions the server was still writing when its screen was left, so the
 * app can say when they're ready (src/ui/VocabReadyBanner.tsx). The app can only look while it's
 * running: the server doesn't push anything.
 */
export type VocabWatch = { language: Language; state: 'waiting' | 'ready' | 'failed' } | null;

/** What a bank in this state means for the watch: still writing, or finished (well or not). */
export function watchStateOf(bank: VocabBank['state']): 'waiting' | 'ready' | 'failed' {
  return bank === 'preparing' ? 'waiting' : bank === 'ready' ? 'ready' : 'failed';
}

export function createVocabWatch() {
  let value: VocabWatch = null;
  const listeners = new Set<() => void>();
  const set = (next: VocabWatch) => {
    value = next;
    listeners.forEach((l) => l());
  };
  return {
    get: (): VocabWatch => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** The screen was left while this language's questions were being written. */
    start: (language: Language) => set({ language, state: 'waiting' }),
    /** The questions finished; ignored unless that language is the one being waited on. */
    finish: (language: Language, state: 'ready' | 'failed') => {
      if (value?.language === language && value.state === 'waiting') set({ language, state });
    },
    /** Stop waiting, or hide the banner (it was opened, dismissed, or the screen is open again). */
    clear: () => { if (value) set(null); },
  };
}

export const vocabWatch = createVocabWatch();
