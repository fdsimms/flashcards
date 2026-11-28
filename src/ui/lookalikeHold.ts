import { heldCards, lookalikeIndex, seenEvents, seenSince } from '../core/lookalikes';
import { quietHeldIds } from '../core/quietMode';
import { heldReverseCards } from '../core/reverseHold';
import type { Card, DeckSettings, Note } from '../core/types';
import type { Repo } from '../db/repo';

/**
 * The cards held back because a lookalike was just seen, for the deck list's counts: the same
 * `heldCards` Review applies (src/ui/ReviewForms.tsx), from the answers and practice that can matter.
 * A new reverse card waiting for its word to be recognized is held with them (`heldReverseCards`),
 * and every listening card while Quiet mode is on (`quietHeldIds`).
 */
export async function loadHeld(repo: Repo, a: {
  notes: Note[];
  cards: Card[];
  settings: Map<string, DeckSettings>;
  now: Date;
  dayStartsAtHour: number;
  /** Whether Quiet mode is on, as Review applies it (`quietActive`). */
  quiet: boolean;
}): Promise<Set<string>> {
  const since = seenSince(a.now, a.dayStartsAtHour);
  const [recent, practice] = await Promise.all([repo.listReviews(since), repo.listPractice(since)]);
  const lookalikes = heldCards({
    cards: a.cards,
    deckOf: new Map(a.notes.map((n) => [n.id, n.deck])),
    index: lookalikeIndex(a.notes),
    events: seenEvents(recent, new Map(a.cards.map((c) => [c.id, c.noteId])), practice),
    settings: a.settings,
    now: a.now,
    dayStartsAtHour: a.dayStartsAtHour,
  });
  return new Set([...lookalikes, ...heldReverseCards(a.cards, a.notes), ...quietHeldIds(a.cards, a.quiet)]);
}
