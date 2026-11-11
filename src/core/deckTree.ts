import { buildQueue, isLearning, studiable, type Queue, type StudiedToday } from './queue';
import type { Card, DeckParams } from './types';

/**
 * Decks as Anki nests them: "A::B::C" is C inside B inside A. Studying a deck studies its
 * subdecks too, and every deck on the way up applies its own daily limits, as in Anki: a card in
 * Polski::Odmiana counts against Odmiana's new-card limit and against Polski's.
 */

/** "A::B::C" -> ["A", "A::B", "A::B::C"]. */
export function deckLineage(deck: string): string[] {
  const parts = deck.split('::');
  return parts.map((_, i) => parts.slice(0, i + 1).join('::'));
}

export function isInDeck(deck: string, root: string): boolean {
  return deck === root || deck.startsWith(`${root}::`);
}

export interface DeckNode {
  /** Full path, "A::B". */
  deck: string;
  /** Last segment, for display. */
  name: string;
  /** 0 for a top-level deck. */
  depth: number;
}

/**
 * Every deck in display order, parents before children, including parents that hold no cards of
 * their own ("👅 Languages" when every card is in a language's subdeck).
 */
export function deckTree(decks: Iterable<string>): DeckNode[] {
  const all = new Set<string>();
  for (const d of decks) for (const p of deckLineage(d)) all.add(p);
  // Sort by path segments, so "A::B" sits under "A" and before "A B".
  const sorted = [...all].sort((a, b) => {
    const pa = a.split('::');
    const pb = b.split('::');
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
      const c = pa[i].localeCompare(pb[i]);
      if (c !== 0) return c;
    }
    return pa.length - pb.length;
  });
  return sorted.map((deck) => {
    const parts = deck.split('::');
    return { deck, name: parts[parts.length - 1], depth: parts.length - 1 };
  });
}

export interface DeckLimits {
  newPerDay: number;
  reviewsPerDay: number;
}

/** A deck's limits from its Anki settings, else the app's defaults (`NEW_PER_DAY`, `REVIEWS_PER_DAY`). */
export function deckLimits(params: DeckParams | undefined, defaults: DeckLimits): DeckLimits {
  return {
    newPerDay: params?.newPerDay ?? defaults.newPerDay,
    reviewsPerDay: params?.reviewsPerDay ?? defaults.reviewsPerDay,
  };
}

export interface TreeQueueInput {
  /** Every card that might be in the deck or under it, keyed by its note's deck. */
  cardsByDeck: Map<string, Card[]>;
  limitsFor: (deck: string) => DeckLimits;
  /** What each deck studied today, by its own cards only (not its subdecks'). */
  studiedByDeck: Map<string, StudiedToday>;
  dayStartsAtHour: number;
  learnAheadMinutes?: number;
  now?: Date;
}

const dueMs = (c: Card) => new Date(c.sched.due).getTime();

function sumStudied(root: string, studied: Map<string, StudiedToday>): StudiedToday {
  let introduced = 0;
  let reviewed = 0;
  for (const [deck, s] of studied) {
    if (!isInDeck(deck, root)) continue;
    introduced += s.introduced;
    reviewed += s.reviewed;
  }
  return { introduced, reviewed };
}

function childrenOf(root: string, decks: Iterable<string>): string[] {
  const depth = root.split('::').length;
  const out = new Set<string>();
  for (const d of decks) {
    if (!d.startsWith(`${root}::`)) continue;
    out.add(d.split('::').slice(0, depth + 1).join('::'));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** The deck's queue with its own limits and every subdeck's applied, before learn-ahead. */
function limitedQueue(deck: string, input: TreeQueueInput): Queue {
  const own = buildQueue(input.cardsByDeck.get(deck) ?? [], { dayStartsAtHour: input.dayStartsAtHour, now: input.now });
  const children = childrenOf(deck, input.cardsByDeck.keys()).map((c) => limitedQueue(c, input));
  const due = [own.due, ...children.map((c) => c.due)].flat().sort((a, b) => dueMs(a) - dueMs(b));
  const fresh = [own.fresh, ...children.map((c) => c.fresh)].flat();

  const limits = input.limitsFor(deck);
  const studied = sumStudied(deck, input.studiedByDeck);
  let reviewBudget = Math.max(0, limits.reviewsPerDay - studied.reviewed);
  return {
    // Learning cards pass regardless; reviews fill the budget most overdue first.
    due: due.filter((c) => c.sched.state !== 2 || reviewBudget-- > 0),
    fresh: fresh.slice(0, Math.max(0, limits.newPerDay - studied.introduced)),
  };
}

/**
 * What studying `root` shows: due cards and new cards from it and all its subdecks, within every
 * deck's limits. Once both are empty, learning cards anywhere under it come up to the learn-ahead
 * limit early. The deck list's counts and the review screen both come from this.
 */
export function treeQueue(root: string, input: TreeQueueInput): Queue {
  const q = limitedQueue(root, input);
  if (q.due.length || q.fresh.length || !input.learnAheadMinutes) return q;
  const now = (input.now ?? new Date()).getTime();
  const cutoff = now + input.learnAheadMinutes * 60000;
  const ahead: Card[] = [];
  for (const [deck, cards] of input.cardsByDeck) {
    if (!isInDeck(deck, root)) continue;
    for (const c of studiable(cards)) if (isLearning(c) && dueMs(c) <= cutoff) ahead.push(c);
  }
  return { due: ahead.sort((a, b) => dueMs(a) - dueMs(b)), fresh: [] };
}

export interface DeckRow extends DeckNode {
  due: number;
  fresh: number;
  /** Cards that can be studied in the deck and its subdecks. */
  total: number;
}

/** The deck list: every deck, nested, with what studying it would show. */
export function deckRows(input: TreeQueueInput): DeckRow[] {
  return deckTree(input.cardsByDeck.keys()).map((node) => {
    const q = treeQueue(node.deck, input);
    let total = 0;
    for (const [deck, cards] of input.cardsByDeck) {
      if (isInDeck(deck, node.deck)) total += studiable(cards).length;
    }
    return { ...node, due: q.due.length, fresh: q.fresh.length, total };
  });
}

/** Cards grouped by their note's deck. */
export function groupByDeck(cards: Card[], deckOfNote: Map<string, string>): Map<string, Card[]> {
  const out = new Map<string, Card[]>();
  for (const c of cards) {
    const deck = deckOfNote.get(c.noteId) ?? 'Imported';
    (out.get(deck) ?? out.set(deck, []).get(deck)!).push(c);
  }
  return out;
}
