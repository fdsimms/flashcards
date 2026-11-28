/**
 * The header's Home button (`Screen` in kit.tsx): a way back to the tab a long chain of pushed screens
 * started from, in one tap instead of one Back per screen.
 */

/** Root-stack routes presented as sheets. A sheet is closed, not navigated out of, so it gets no Home button.
 *  `tests/homeButton.test.ts` fails when this and the `formSheet` screens in `src/app/_layout.tsx` differ. */
export const SHEET_ROUTES: readonly string[] = [
  'note-editor',
  'quick-add',
  'look-up',
  'journal-entry',
  'read-write',
  'lesson-words',
  'lesson-add',
  'lesson-word-add',
  'cram-edit',
  'deck-new',
  'offline',
  'ipa',
  'now-playing',
  'up-next',
];

/** How many screens the stack must hold, the tab counted when the stack is the root one, before Home
 *  shows: the third, so a screen one push from a tab (Settings) keeps just Back, and the one under it shows both. */
export const HOME_AFTER_SCREENS = 3;

/** Whether a screen `depth` screens into its stack, named `routeName`, gets the Home button. */
export function showsHomeButton(depth: number, routeName: string): boolean {
  return depth >= HOME_AFTER_SCREENS && !SHEET_ROUTES.includes(routeName);
}
