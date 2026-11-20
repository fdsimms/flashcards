import { DECKS_PATH, LESSONS_PATH, PRACTICE_PATH, READ_PATH } from './tabPaths';

type Fallback = typeof DECKS_PATH | typeof LESSONS_PATH | typeof PRACTICE_PATH | typeof READ_PATH;

/**
 * Leaves a screen. `router.back()` does nothing when the stack has no screen under this one, so a
 * Done or "Back to decks" button on such a stack looked pressed and stayed put: this goes to the
 * tab the screen belongs to instead.
 */
export function leaveScreen(router: { canGoBack(): boolean; back(): void; replace(href: Fallback): void }, fallback: Fallback) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** `leaveScreen` for a screen pushed from the deck list. */
export function backToDecks(router: Parameters<typeof leaveScreen>[0]) {
  leaveScreen(router, DECKS_PATH);
}
