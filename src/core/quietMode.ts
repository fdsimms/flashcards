import { nextStudyDayStart } from './day';
import type { Card } from './types';

/**
 * Quiet mode (Franki's own, never written to Anki): for studying where sound isn't possible, on a train
 * or in a waiting room with no headphones. While it's on, listening cards are left out of the queue and
 * Review plays nothing and offers no microphone.
 *
 * It only changes what's offered, never a schedule, and nothing is rated: a set-aside card stays due and
 * is offered again when the mode ends. It's the phone's own, like Vacation mode, so Anki on a computer
 * still offers the card. Unlike Bury it writes nothing and isn't per card. It enters through `queueInput`'s
 * `held`, for the deck list and Review alike (`quietHolds`), so a count never promises a card the deck won't open with.
 *
 * Pure, so it's tested; src/ui/quietPrefs.ts keeps the setting on the phone.
 */

export type QuietChoice = 'hour' | 'three-hours' | 'tomorrow' | 'manual';

/** What the card's chip starts, and the sheet's selected row until another is picked. */
export const DEFAULT_QUIET_CHOICE: QuietChoice = 'three-hours';

export const QUIET_CHOICES: readonly { choice: QuietChoice; label: string }[] = [
  { choice: 'hour', label: 'For 1 hour' },
  { choice: 'three-hours', label: 'For 3 hours' },
  { choice: 'tomorrow', label: 'Until tomorrow' },
  { choice: 'manual', label: 'Until I turn it off' },
];

export interface QuietPrefs {
  /** The choice made, kept so the sheet can show it selected. */
  choice: QuietChoice;
  /** When it ends (an ISO instant); absent for "Until I turn it off". */
  until?: string;
}

const HOUR_MS = 60 * 60 * 1000;

/** The instant `choice` ends when started at `now`; undefined for a choice with no end. */
export function quietEnd(choice: QuietChoice, now: Date, dayStartsAtHour: number): Date | undefined {
  switch (choice) {
    case 'hour': return new Date(now.getTime() + HOUR_MS);
    case 'three-hours': return new Date(now.getTime() + 3 * HOUR_MS);
    case 'tomorrow': return nextStudyDayStart(now, dayStartsAtHour);
    case 'manual': return undefined;
  }
}

/** Quiet mode started at `now` with `choice`. */
export function startQuiet(choice: QuietChoice, now: Date, dayStartsAtHour: number): QuietPrefs {
  const until = quietEnd(choice, now, dayStartsAtHour);
  return until ? { choice, until: until.toISOString() } : { choice };
}

/** Whether it's on at `now`: set, and not past its end. */
export function quietActive(prefs: QuietPrefs | null | undefined, now: Date): boolean {
  if (!prefs) return false;
  return !prefs.until || new Date(prefs.until).getTime() > now.getTime();
}

/** What the saved text holds; anything unreadable is off. */
export function parseQuiet(raw: string | null | undefined): QuietPrefs | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<QuietPrefs> | null;
    if (!v || !QUIET_CHOICES.some((c) => c.choice === v.choice)) return null;
    if (v.until !== undefined && Number.isNaN(new Date(v.until).getTime())) return null;
    return { choice: v.choice as QuietChoice, ...(v.until ? { until: v.until } : {}) };
  } catch {
    return null;
  }
}

/** Whether the card plays a sound on its front and asks what it means: the listening card (`GenerateAudioCard`). */
export function isListeningCard(card: Pick<Card, 'kind'>): boolean {
  return card.kind === 'audio';
}

/** The Practice tools that are nothing without sound (ids from tools.ts): Quiet mode turns them off. */
const SOUND_ONLY_TOOLS: readonly string[] = ['hearing'];

/** Whether a Practice tool or daily extra can't be done without sound. */
export function needsSound(toolId: string): boolean {
  return SOUND_ONLY_TOOLS.includes(toolId);
}

/** Whether `card` is set aside while Quiet mode is `active`. */
export function quietHolds(card: Pick<Card, 'kind'>, active: boolean): boolean {
  return active && isListeningCard(card);
}

/** The ids `queueInput`'s `held` takes for Quiet mode: every listening card while it's on. */
export function quietHeldIds(cards: readonly Card[] | undefined, active: boolean): Set<string> {
  const ids = new Set<string>();
  if (!active || !cards) return ids;
  for (const c of cards) if (isListeningCard(c)) ids.add(c.id);
  return ids;
}

/** The end of Quiet mode as the banner says it: "for 2 more hours", "until tomorrow" or "until you turn it off". */
export function quietEndsText(prefs: QuietPrefs, now: Date): string {
  if (!prefs.until) return 'until you turn it off';
  if (prefs.choice === 'tomorrow') return 'until tomorrow';
  const ms = new Date(prefs.until).getTime() - now.getTime();
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes < 60) return `for ${minutes} more ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `for ${hours} more ${hours === 1 ? 'hour' : 'hours'}`;
}
