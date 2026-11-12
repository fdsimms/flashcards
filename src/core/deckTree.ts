import { isInProgress } from './progress';
import { buildQueue, isLearning, studiable, type Queue, type StudiedToday } from './queue';
import type { Card, DeckParams, DeckSettings } from './types';

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
  /** A deck's progress gate: the most cards in progress it and its subdecks may hold. Undefined: no gate. */
  gateFor?: (deck: string) => number | undefined;
  dayStartsAtHour: number;
  learnAheadMinutes?: number;
  now?: Date;
  /**
   * Cards held back today because a lookalike was just seen (`heldCards`, lookalikes.ts). Only New
   * and Review cards are ever held; learning cards keep their steps.
   */
  held?: Set<string>;
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
/** Cards still in progress in the deck and its subdecks: what a progress gate counts. */
export function inProgressCount(root: string, cardsByDeck: Map<string, Card[]>): number {
  let n = 0;
  for (const [deck, cards] of cardsByDeck) {
    if (!isInDeck(deck, root)) continue;
    for (const c of studiable(cards)) if (isInProgress(c)) n++;
  }
  return n;
}

/** How many new cards a gated deck lets in now: its cap less what's in progress under it. */
function gateBudget(deck: string, input: TreeQueueInput): number | undefined {
  const cap = input.gateFor?.(deck);
  return cap === undefined ? undefined : Math.max(0, cap - inProgressCount(deck, input.cardsByDeck));
}

/**
 * The deck's queue with its own limits and every subdeck's applied, before learn-ahead. Under a
 * progress gate (on this deck or one above it), daily new-card limits don't apply: the gate is
 * what holds new cards back.
 */
function limitedQueue(deck: string, input: TreeQueueInput, gatedAbove: boolean): Queue {
  const gate = gateBudget(deck, input);
  const underGate = gatedAbove || gate !== undefined;
  const mine = input.cardsByDeck.get(deck) ?? [];
  const own = buildQueue(input.held?.size ? mine.filter((c) => !input.held!.has(c.id)) : mine, { dayStartsAtHour: input.dayStartsAtHour, now: input.now });
  const children = childrenOf(deck, input.cardsByDeck.keys()).map((c) => limitedQueue(c, input, underGate));
  const due = [own.due, ...children.map((c) => c.due)].flat().sort((a, b) => dueMs(a) - dueMs(b));
  const fresh = [own.fresh, ...children.map((c) => c.fresh)].flat();

  const limits = input.limitsFor(deck);
  const studied = sumStudied(deck, input.studiedByDeck);
  let reviewBudget = Math.max(0, limits.reviewsPerDay - studied.reviewed);
  const newBudget = gate ?? (underGate ? Number.POSITIVE_INFINITY : Math.max(0, limits.newPerDay - studied.introduced));
  return {
    // Learning cards pass regardless; reviews fill the budget most overdue first.
    due: due.filter((c) => c.sched.state !== 2 || reviewBudget-- > 0),
    fresh: fresh.slice(0, newBudget),
  };
}

/**
 * What studying `root` shows: due cards and new cards from it and all its subdecks, within every
 * deck's limits. Once both are empty, learning cards anywhere under it come up to the learn-ahead
 * limit early. The deck list's counts and the review screen both come from this.
 */
export function treeQueue(root: string, input: TreeQueueInput): Queue {
  // A gate on a deck above this one still applies: opening a subdeck must not get around it.
  const above = deckLineage(root).slice(0, -1).map((d) => gateBudget(d, input)).filter((b): b is number => b !== undefined);
  const limited = limitedQueue(root, input, above.length > 0);
  const q = above.length ? { ...limited, fresh: limited.fresh.slice(0, Math.min(...above)) } : limited;
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
  /** For a gated deck: cards in progress under it, and its cap. */
  gate?: { inProgress: number; cap: number };
}

/** The deck list: every deck, nested, with what studying it would show. */
export function deckRows(input: TreeQueueInput): DeckRow[] {
  return deckTree(input.cardsByDeck.keys()).map((node) => {
    const q = treeQueue(node.deck, input);
    let total = 0;
    for (const [deck, cards] of input.cardsByDeck) {
      if (isInDeck(deck, node.deck)) total += studiable(cards).length;
    }
    const cap = input.gateFor?.(node.deck);
    const gate = cap === undefined ? undefined : { inProgress: inProgressCount(node.deck, input.cardsByDeck), cap };
    return { ...node, due: q.due.length, fresh: q.fresh.length, total, ...(gate ? { gate } : {}) };
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

/**
 * A deck setting that its subdecks share: the deck's own, else its nearest ancestor's ("A::B::C"
 * falls back to "A::B", then "A"), else undefined for the caller's default.
 */
export function inheritedSetting<K extends keyof DeckSettings>(deck: string, all: Map<string, DeckSettings>, key: K): DeckSettings[K] | undefined {
  for (const d of deckLineage(deck).reverse()) {
    const v = all.get(d)?.[key];
    if (v !== undefined) return v;
  }
  return undefined;
}
