/**
 * Counts each time a sync rewrote Franki's cards from the collection (another device's answers, an
 * edit made in Anki), for a screen that holds cards it loaded earlier. Review reads them once and
 * answers from that copy: without this it went on scheduling from the state before the sync, wrote
 * that over the newer card and logged a second review of a card already answered elsewhere.
 * One for the app, like `reviewWrites`. Pure, so it's tested.
 */
export function changeCounter() {
  let count = 0;
  const listeners = new Set<() => void>();
  return {
    get: (): number => count,
    bump(): void {
      count++;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const collectionChanged = changeCounter();
