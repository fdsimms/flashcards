import type { SoFar } from './api';

/**
 * A series' "Story so far" and its "Welcome back" recap (docs/read-and-listen/architecture.md,
 * Stories, Welcome back): the English recap of every episode already told, from what the server
 * stores, with no request of its own.
 */

/** Days since an episode was last finished after which an episode opens on the Welcome back recap. */
export const WELCOME_BACK_DAYS = 7;

/** How many of the latest episodes the series page's card lists before "All episodes". */
export const RECENT_EPISODES = 3;

/** Whether the learner has been away long enough, from a series with something to recap. A server older than the recap sends none. */
export function welcomeBackDue(soFar: SoFar | null | undefined): boolean {
  return !!soFar && soFar.recaps.length > 0 && soFar.away_days !== null && soFar.away_days >= WELCOME_BACK_DAYS;
}

/** How long they were away, in the words a person would use: "9 days", "3 weeks", "2 months". */
export function awayText(days: number): string {
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

/** The recaps the card lists: the latest few, or all of them once expanded. */
export function recapsShown(soFar: SoFar, all: boolean): SoFar['recaps'] {
  return all ? soFar.recaps : soFar.recaps.slice(-RECENT_EPISODES);
}
