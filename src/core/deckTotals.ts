import { isBuried } from './queue';
import type { Card } from './types';
import { MATURE_DAYS } from './stats';

/** How many notes and how many cards are in one state. A note counts once per state, however many of its cards are in it. */
export interface StateCount { notes: number; cards: number }

/**
 * A deck's cards by state, as Anki's Card Counts splits them (`computeStats`): suspended and buried
 * apart from the stage a card is in, relearning counted as learning. `new` is new and not suspended
 * (and not buried today), the "waiting to be introduced" figure, not today's limited new count.
 * Skill cards (`skillCards`) are drills, not words: all of them are counted in `skills`, in no other state.
 */
export interface DeckTotals { new: StateCount; learning: StateCount; young: StateCount; mature: StateCount; suspended: StateCount; buried: StateCount; skills: StateCount }

export type DeckTotalsKey = keyof DeckTotals;

/** Row order and wording, shared by the deck list's line and the counts screen. */
export const TOTALS_LABELS: readonly { key: DeckTotalsKey; label: string; hint?: string }[] = [
  { key: 'new', label: 'New', hint: 'Not suspended, not yet studied' },
  { key: 'learning', label: 'Learning', hint: 'Including cards being learned again' },
  { key: 'young', label: 'Young', hint: `Reviews less than ${MATURE_DAYS} days apart` },
  { key: 'mature', label: 'Mature', hint: `Reviews ${MATURE_DAYS} days or more apart` },
  { key: 'suspended', label: 'Suspended' },
  { key: 'buried', label: 'Buried', hint: 'Held back until tomorrow' },
  { key: 'skills', label: 'Skill cards', hint: 'Drills for a skill, in any state' },
];

/** The state a card counts under: a retired card under none. */
export function totalsKey(card: Card, skillCards: Set<string>, now: Date, dayStartsAtHour: number): DeckTotalsKey | null {
  if (card.retired) return null;
  if (skillCards.has(card.id)) return 'skills';
  if (card.suspended) return 'suspended';
  if (isBuried(card, now, dayStartsAtHour)) return 'buried';
  const s = card.sched;
  if (s.state === 0) return 'new';
  if (s.state === 2) return s.scheduledDays >= MATURE_DAYS ? 'mature' : 'young';
  return 'learning';
}

export function emptyTotals(): DeckTotals {
  const none = (): StateCount => ({ notes: 0, cards: 0 });
  return { new: none(), learning: none(), young: none(), mature: none(), suspended: none(), buried: none(), skills: none() };
}

/** Totals over `cards`: every card of the deck and its subdecks, as the caller gathers them. */
export function deckTotals(cards: Iterable<Card>, skillCards: Set<string>, now: Date, dayStartsAtHour: number): DeckTotals {
  const out = emptyTotals();
  const seen = new Map<DeckTotalsKey, Set<string>>();
  for (const c of cards) {
    const key = totalsKey(c, skillCards, now, dayStartsAtHour);
    if (!key) continue;
    out[key].cards++;
    const notes = seen.get(key) ?? seen.set(key, new Set()).get(key)!;
    if (!notes.has(c.noteId)) { notes.add(c.noteId); out[key].notes++; }
  }
  return out;
}

/**
 * The line under a deck's name on the deck list: new notes waiting, then suspended and buried cards,
 * each only when there is one. Empty when there's nothing to say.
 */
export function totalsLine(t: DeckTotals): string {
  const parts: string[] = [];
  if (t.new.notes) parts.push(`${t.new.notes.toLocaleString()} new ${t.new.notes === 1 ? 'note' : 'notes'} waiting`);
  if (t.suspended.cards) parts.push(`${t.suspended.cards.toLocaleString()} suspended`);
  if (t.buried.cards) parts.push(`${t.buried.cards.toLocaleString()} buried`);
  return parts.join(' · ');
}
