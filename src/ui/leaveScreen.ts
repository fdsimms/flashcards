import { DECKS_PATH } from './tabPaths';

/**
 * Leaves a screen that was pushed from the deck list. `router.back()` does nothing when the stack
 * has no screen under this one, so a "Back to decks" button on such a stack looked pressed and
 * stayed put: it goes to the Decks tab instead.
 */
export function backToDecks(router: { canGoBack(): boolean; back(): void; replace(href: typeof DECKS_PATH): void }) {
  if (router.canGoBack()) router.back();
  else router.replace(DECKS_PATH);
}
