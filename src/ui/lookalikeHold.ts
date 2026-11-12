import { heldCards, lookalikeIndex, seenEvents, seenSince } from '../core/lookalikes';
import type { Card, DeckSettings, Note } from '../core/types';
import type { Repo } from '../db/repo';

/**
 * The cards held back because a lookalike was just seen, for the deck list's counts: the same
 * `heldCards` Review applies (src/ui/ReviewForms.tsx), from the answers and practice that can matter.
 */
export async function loadHeld(repo: Repo, a: {
  notes: Note[];
  cards: Card[];
  settings: Map<string, DeckSettings>;
  now: Date;
  dayStartsAtHour: number;
}): Promise<Set<string>> {
  const since = seenSince(a.now, a.dayStartsAtHour);
  const [recent, practice] = await Promise.all([repo.listReviews(since), repo.listPractice(since)]);
  return heldCards({
    cards: a.cards,
    deckOf: new Map(a.notes.map((n) => [n.id, n.deck])),
    index: lookalikeIndex(a.notes),
    events: seenEvents(recent, new Map(a.cards.map((c) => [c.id, c.noteId])), practice),
    settings: a.settings,
    now: a.now,
    dayStartsAtHour: a.dayStartsAtHour,
  });
}
