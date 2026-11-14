import { NEW_PER_DAY, REVIEWS_PER_DAY } from './config';
import { nextStudyDayStart, studyDayKey } from './day';
import { ankiToday, DEFAULT_ORDER, gatherNew, inFilteredOrder, mix, REVIEW, sortNew, sortReviews, type SortContext } from './order';
import { boostCap, type Boost } from './priority';
import { isInProgress } from './progress';
import { isBuried, isDue, isInterdayLearning, isLearning, studiable, type Queue, type StudiedToday } from './queue';
import { paramsForDeck } from './scheduler';
import { scaleLimits, vacationPlan, type VacationPlan, type VacationPrefs } from './vacation';
import type { BurySettings, Card, CollectionSettings, DeckParams, DeckSettings, Note, StudyOrder } from './types';

/**
 * Decks as Anki nests them: "A::B::C" is C inside B inside A. Studying a deck studies its
 * subdecks too, within its limits and theirs (`treeQueue`): studying Polski, a card in
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
 * their own ("👅 Languages" when every card is in a language's subdeck). `position` is the place
 * a deck was dragged to among its siblings (`DeckSettings.position`, `compareDecks`).
 */
export function deckTree(decks: Iterable<string>, position?: (deck: string) => number | undefined): DeckNode[] {
  const all = new Set<string>();
  for (const d of decks) for (const p of deckLineage(d)) all.add(p);
  return [...all].sort((a, b) => compareDecks(a, b, position)).map((deck) => {
    const parts = deck.split('::');
    return { deck, name: parts[parts.length - 1], depth: parts.length - 1 };
  });
}

/**
 * The order of two decks on the deck list, part by part from the top, so a subdeck sits under its
 * parent: at each level a deck given a place (`position`, its `DeckSettings.position`) comes
 * before one with none, and decks without one are in Anki's order, by name.
 */
export function compareDecks(a: string, b: string, position?: (deck: string) => number | undefined): number {
  const pa = a.split('::');
  const pb = b.split('::');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const x = position?.(pa.slice(0, i + 1).join('::'));
    const y = position?.(pb.slice(0, i + 1).join('::'));
    if (x !== undefined && y !== undefined && x !== y) return x - y;
    if (x !== undefined && y === undefined) return -1;
    if (x === undefined && y !== undefined) return 1;
    const c = pa[i].localeCompare(pb[i]);
    if (c !== 0) return c;
  }
  return pa.length - pb.length;
}

export interface DeckLimits {
  newPerDay: number;
  reviewsPerDay: number;
}

/**
 * A deck's limits for the study day `todayKey`: a today-only limit set for that day (Anki's
 * Custom Study), else its Anki settings, else the app's defaults (`NEW_PER_DAY`, `REVIEWS_PER_DAY`).
 */
export function deckLimits(params: DeckParams | undefined, defaults: DeckLimits, todayKey?: string): DeckLimits {
  const today = (l?: { limit: number; day: string }) => (l && todayKey && l.day === todayKey ? l.limit : undefined);
  return {
    newPerDay: today(params?.newLimitToday) ?? params?.newPerDay ?? defaults.newPerDay,
    reviewsPerDay: today(params?.reviewLimitToday) ?? params?.reviewsPerDay ?? defaults.reviewsPerDay,
  };
}

/** The deck a card belongs to (its own, else its note's), whose settings schedule it. */
export function cardHomeDeck(card: Card, noteDeck: string): string {
  return card.deck ?? noteDeck;
}

/** The deck a card is studied in: the Anki filtered deck it's in, else its home deck. */
export function cardDeck(card: Card, noteDeck: string): string {
  return card.filteredDeck ?? cardHomeDeck(card, noteDeck);
}

export interface TreeQueueInput {
  /** Every card that might be in the deck or under it, keyed by the deck it's studied in (`cardDeck`). */
  cardsByDeck: Map<string, Card[]>;
  /** A deck's limits today (`deckLimits`). */
  limitsFor: (deck: string) => DeckLimits;
  /** A deck's Anki settings: its display order, burying, and whether it's a filtered deck. */
  paramsFor?: (deck: string) => DeckParams | undefined;
  /** A card's home deck (`cardHomeDeck`), whose burying options it follows. Defaults to the deck it's studied in. */
  homeDeckOf?: (card: Card) => string;
  /** What each deck studied today, by its own cards only (not its subdecks'). */
  studiedByDeck: Map<string, StudiedToday>;
  /** A deck's progress gate: the most cards in progress it and its subdecks may hold. Undefined: no gate. */
  gateFor?: (deck: string) => number | undefined;
  dayStartsAtHour: number;
  learnAheadMinutes?: number;
  /** Anki's day number (`ankiToday`), which seeds its shuffled orders. */
  ankiToday?: number;
  /** The collection's v3 options (`CollectionSettings`). */
  newCardsIgnoreReviewLimit?: boolean;
  applyAllParentLimits?: boolean;
  now?: Date;
  /**
   * Cards held back today because a lookalike was just seen (`heldCards`, lookalikes.ts). Only New
   * and Review cards are ever held; learning cards keep their steps.
   */
  held?: Set<string>;
  /** Tagged cards that come first when `root` is studied (`boostFor`, priority.ts). */
  boostFor?: (root: string) => Boost | undefined;
  /** Vacation mode, resolved (`vacationPlan`): paused shows nothing, weakest first overrides the review order. The limits are scaled in `queueInput`. */
  vacation?: VacationPlan;
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

/** Cards still in progress in the deck and its subdecks: what a progress gate counts. */
export function inProgressCount(root: string, cardsByDeck: Map<string, Card[]>): number {
  let n = 0;
  for (const [deck, cards] of cardsByDeck) {
    if (!isInDeck(deck, root)) continue;
    for (const c of studiable(cards)) if (isInProgress(c)) n++;
  }
  return n;
}

/**
 * How many new cards a gated deck lets in now: its cap less what's in progress under it, and never
 * more than its own daily new limit has room for, so turning a gate on doesn't let in the whole
 * cap in one day.
 */
function gateBudget(deck: string, input: TreeQueueInput): number | undefined {
  const cap = input.gateFor?.(deck);
  if (cap === undefined) return undefined;
  const daily = input.limitsFor(deck).newPerDay - sumStudied(deck, input.studiedByDeck).introduced;
  return Math.max(0, Math.min(cap - inProgressCount(deck, input.cardsByDeck), daily));
}

interface LimitNode { review: number; new: number; capNewToReview: boolean }

/**
 * What studying `root` shows, in the order it comes up, as Anki's v3 scheduler builds it
 * (rslib scheduler/queue/builder):
 *
 * - **Limits form a tree** rooted at `root`, or at its top-level deck when the collection's
 *   "apply all parent limits" is on. Each deck's room is its limit less what it and its subdecks
 *   studied today; unless "new cards ignore review limit" is on, new cards studied today also use
 *   up review room, and new room never exceeds review room. A subdeck never has more room than
 *   its parent. A card is taken only while every deck from its own up to the root has room, and
 *   taking it uses room in each. A filtered deck has no limits.
 * - **Gathering order:** learning cards on steps within the day (never limited), then day-long
 *   learning cards and reviews (in the root's review order, using review room, day-long learning
 *   first), then new cards (by the root's gather and sort order). A card whose sibling was
 *   gathered first is held back when that sibling's preset buries its kind.
 * - **Presentation:** learning cards due now, then reviews mixed with day-long learning and new
 *   cards (by the root's mix options), then learning cards due within the learn-ahead limit.
 *
 * A progress gate (Franki's own) limits new cards on the gated deck to the smaller of its room
 * and the deck's own daily new limit; the daily new limits of the decks under it don't apply. A
 * gate on a deck above `root` still holds when a subdeck is opened. The deck list's counts and the
 * review screen both come from this.
 */
export function treeQueue(root: string, input: TreeQueueInput): Queue {
  const now = input.now ?? new Date();
  const h = input.dayStartsAtHour;
  const cap = !input.newCardsIgnoreReviewLimit;
  const paramsFor = input.paramsFor ?? (() => undefined);
  if (input.vacation?.paused) return { due: [], fresh: [], order: [] };

  // ---- the limit tree ----
  const top = input.applyAllParentLimits ? deckLineage(root)[0] : root;
  const active = [...input.cardsByDeck.keys()].filter((d) => isInDeck(d, root));
  const nodeDecks = new Set<string>();
  for (const d of [root, ...active]) for (const l of deckLineage(d)) if (isInDeck(l, top)) nodeDecks.add(l);
  const gatedAt = (d: string) => deckLineage(d).some((l) => input.gateFor?.(l) !== undefined);
  const nodes = new Map<string, LimitNode>();
  for (const d of [...nodeDecks].sort((a, b) => a.split('::').length - b.split('::').length)) {
    let node: LimitNode;
    if (paramsFor(d)?.filtered) {
      node = { review: 9999, new: 9999, capNewToReview: false };
    } else {
      const limits = input.limitsFor(d);
      const done = sumStudied(d, input.studiedByDeck);
      let review = limits.reviewsPerDay - done.reviewed;
      let fresh = limits.newPerDay - done.introduced;
      // Under a progress gate, the gate (on the gated deck, within its own daily limit) or nothing (below it) replaces the daily new limit.
      if (gatedAt(d)) fresh = gateBudget(d, input) ?? Number.POSITIVE_INFINITY;
      if (cap) {
        review -= done.introduced;
        fresh = Math.min(fresh, review);
      }
      node = { review: Math.max(0, review), new: Math.max(0, fresh), capNewToReview: cap };
    }
    const parent = d === top ? undefined : nodes.get(deckLineage(d).at(-2)!);
    if (parent) node = { ...node, review: Math.min(node.review, parent.review), new: Math.min(node.new, parent.new) };
    nodes.set(d, node);
  }
  // A gate above the root still applies when the root's parents' limits don't.
  const gatesAbove = deckLineage(root).slice(0, -1).filter((d) => !nodes.has(d)).map((d) => gateBudget(d, input)).filter((b): b is number => b !== undefined);
  if (gatesAbove.length) nodes.get(root)!.new = Math.min(nodes.get(root)!.new, ...gatesAbove);
  const pathOf = (deck: string) => deckLineage(deck).filter((d) => nodes.has(d)).reverse();
  const deckOfCard = new Map<string, string>();
  for (const d of active) for (const c of input.cardsByDeck.get(d)!) deckOfCard.set(c.id, d);
  /** Whether every deck on the card's path still has room for it. */
  const hasRoom = (card: Card, kind: 'review' | 'new'): boolean =>
    pathOf(deckOfCard.get(card.id)!).every((d) => nodes.get(d)![kind] > 0);
  const admit = (card: Card, kind: 'review' | 'new'): boolean => {
    const path = pathOf(deckOfCard.get(card.id)!);
    if (!hasRoom(card, kind)) return false;
    for (const d of path) {
      const n = nodes.get(d)!;
      n[kind]--;
      if (kind === 'review' && n.capNewToReview) n.new = Math.min(n.new, n.review);
    }
    return true;
  };

  // ---- gathering ----
  const rootFiltered = paramsFor(root)?.filtered;
  // A filtered deck keeps its own order: Anki builds it with no sort, by its cards' places in it.
  const ownOrder: StudyOrder = rootFiltered ? { ...DEFAULT_ORDER, newSortOrder: 1 } : paramsFor(root)?.order ?? DEFAULT_ORDER;
  // Vacation mode's weakest-first order, but never over a filtered deck's own place order.
  const order: StudyOrder = input.vacation?.weakestFirst && !rootFiltered ? { ...ownOrder, reviewOrder: REVIEW.relativeOverdueness } : ownOrder;
  const homeDeckOf = input.homeDeckOf ?? ((c: Card) => deckOfCard.get(c.id)!);
  const ctx: SortContext = {
    now, dayStartsAtHour: h, ankiToday: input.ankiToday, deckOf: (c) => deckOfCard.get(c.id)!, noteOf: (c) => c.noteId,
    weightsOf: (c) => paramsFor(homeDeckOf(c))?.weights ?? [],
  };
  const all = active.flatMap((d) => studiable(input.cardsByDeck.get(d)!)).filter((c) => !isBuried(c, now, h) && !input.held?.has(c.id));
  const nextDay = nextStudyDayStart(now, h).getTime();
  // Siblings: a card is held back when one gathered before it has a preset burying its kind.
  const buryFlags = new Map<string, BurySettings>();
  const heldBack = (c: Card, kind: keyof BurySettings | null): boolean => {
    const prev = buryFlags.get(c.noteId);
    const own = paramsFor(homeDeckOf(c))?.bury;
    if (own) buryFlags.set(c.noteId, { new: !!prev?.new || own.new, reviews: !!prev?.reviews || own.reviews, interdayLearning: !!prev?.interdayLearning || own.interdayLearning });
    return kind !== null && !!prev?.[kind];
  };
  // A card being previewed in a filtered deck (Anki's queue 4) comes back like a learning step, when its preview time comes.
  const shownAt = (c: Card) => (c.previewDue ? new Date(c.previewDue).getTime() : dueMs(c));
  const previewing = all.filter((c) => c.previewDue);
  const rest = all.filter((c) => !c.previewDue);
  // A deck that only previews holds every card as a review, as Anki makes them when it fills one.
  const previewDeck = rootFiltered && !rootFiltered.reschedule;
  const intraday = [...previewing, ...(previewDeck ? [] : rest.filter((c) => isLearning(c) && !isInterdayLearning(c, h)))]
    .filter((c) => shownAt(c) < nextDay);
  for (const c of intraday) heldBack(c, null);
  const gatherDue = (cards: Card[], kind: keyof BurySettings) =>
    // Room first, as Anki checks the limit before a card is gathered: one the limits leave out buries nothing.
    sortReviews(cards, order.reviewOrder, ctx).filter((c) => hasRoom(c, 'review') && !heldBack(c, kind) && admit(c, 'review'));
  // A review in a filtered deck is due whatever its own due date: its due there is its place in the deck.
  const reviewDue = (c: Card) => c.sched.state === 2 && (inFilteredOrder(c) || isDue(c, now, h));
  const interday = previewDeck ? [] : gatherDue(rest.filter((c) => isInterdayLearning(c, h) && dueMs(c) < nextDay), 'interdayLearning');
  const reviews = gatherDue(previewDeck ? rest : rest.filter(reviewDue), 'reviews');
  const newCards = rest.filter((c) => c.sched.state === 0);
  const gatherFresh = (cards: Card[], limit = Number.POSITIVE_INFINITY) => {
    let n = 0;
    return sortNew(
      gatherNew(cards, order.newGatherPriority, ctx, (c) => n < limit && hasRoom(c, 'new') && !heldBack(c, 'new') && admit(c, 'new') && ++n > 0),
      order.newSortOrder, ctx,
    );
  };
  // Tagged cards first: gathered ahead of the rest, up to a share of the room the limits leave,
  // so they use the same limits and a boosted card that doesn't fit waits in line like any other.
  const boost = previewDeck ? undefined : input.boostFor?.(root);
  const boosted = boost ? newCards.filter((c) => boost.noteIds.has(c.noteId)) : [];
  const firstNew = boosted.length ? gatherFresh(boosted, boostCap(boost!.percent, nodes.get(root)!.new)) : [];
  const firstIds = new Set(firstNew.map((c) => c.id));
  const fresh = previewDeck ? [] : [...firstNew, ...gatherFresh(newCards.filter((c) => !firstIds.has(c.id)))];

  // ---- presentation ----
  const learnOrder = (a: Card, b: Card) => Number(a.sched.reps === 0) - Number(b.sched.reps === 0) || shownAt(a) - shownAt(b);
  const ahead = now.getTime() + (input.learnAheadMinutes ?? 0) * 60000;
  const learnNow = intraday.filter((c) => shownAt(c) <= now.getTime()).sort(learnOrder);
  const learnAhead = intraday.filter((c) => shownAt(c) > now.getTime() && shownAt(c) <= ahead).sort(learnOrder);
  const main = mix(mix(reviews, interday, order.interdayLearningMix), fresh, order.newMix);
  return {
    due: [...learnNow, ...interday, ...reviews, ...learnAhead],
    fresh,
    order: [...learnNow, ...main, ...learnAhead],
  };
}

/**
 * The input to `treeQueue` and `deckRows` from what the screens load: every card in the deck it's
 * studied in, each deck's limits for today and Anki settings, and the collection's settings. The
 * deck list and the review screen both build it here, so a deck never shows one count on the list
 * and another when opened.
 */
export function queueInput(a: {
  notes: Iterable<Note>;
  cards: Card[];
  params: Map<string, DeckParams>;
  studied: Map<string, StudiedToday>;
  gateFor?: (deck: string) => number | undefined;
  collection: CollectionSettings;
  now: Date;
  /** Lookalikes held back (`heldCards`). */
  held?: Set<string>;
  /** Tagged cards first (`boostFor`). */
  boostFor?: (root: string) => Boost | undefined;
  /** Vacation mode's setting (`VacationPrefs`), resolved here so the deck list and the review screen both apply it. */
  vacation?: VacationPrefs;
}): TreeQueueInput {
  const deckOfNote = new Map([...a.notes].map((n) => [n.id, n.deck]));
  const todayKey = studyDayKey(a.now, a.collection.dayStartsAtHour);
  const vacation = vacationPlan(a.vacation, a.cards, a.now, a.collection.dayStartsAtHour);
  return {
    cardsByDeck: groupByDeck(a.cards, deckOfNote),
    limitsFor: (d) => {
      const p = paramsForDeck(d, a.params);
      const limits = deckLimits(p, { newPerDay: NEW_PER_DAY, reviewsPerDay: REVIEWS_PER_DAY }, todayKey);
      return scaleLimits(limits, vacation, { new: p?.newLimitToday?.day === todayKey, review: p?.reviewLimitToday?.day === todayKey });
    },
    paramsFor: (d) => paramsForDeck(d, a.params),
    homeDeckOf: (c) => cardHomeDeck(c, deckOfNote.get(c.noteId) ?? 'Imported'),
    studiedByDeck: a.studied,
    gateFor: a.gateFor,
    dayStartsAtHour: a.collection.dayStartsAtHour,
    learnAheadMinutes: a.collection.learnAheadMinutes,
    newCardsIgnoreReviewLimit: a.collection.newCardsIgnoreReviewLimit,
    applyAllParentLimits: a.collection.applyAllParentLimits,
    ankiToday: ankiToday(a.now, a.collection.dayStartsAtHour, a.collection.collectionCreated, a.collection.creationOffset),
    now: a.now,
    held: a.held,
    boostFor: a.boostFor,
    vacation,
  };
}

export interface DeckRow extends DeckNode {
  due: number;
  fresh: number;
  /** Cards that can be studied in the deck and its subdecks. */
  total: number;
  /** Cards in the deck and its subdecks that were never studied and aren't suspended: all of them, not just today's new cards. */
  unstudied: number;
  /** For a gated deck: cards in progress under it, and its cap. */
  gate?: { inProgress: number; cap: number };
}

/**
 * The rows the deck list shows: a collapsed deck's subdecks hidden (at every depth), and each row
 * saying whether it has subdecks to show or hide. `rows` are in tree order, parents first.
 */
export function shownDeckRows<R extends DeckNode>(rows: R[], collapsed: Set<string>): (R & { hasSubdecks: boolean; collapsed: boolean })[] {
  const out: (R & { hasSubdecks: boolean; collapsed: boolean })[] = [];
  rows.forEach((row, i) => {
    const hidden = [...collapsed].some((c) => c !== row.deck && isInDeck(row.deck, c));
    if (hidden) return;
    const next = rows[i + 1];
    const hasSubdecks = !!next && next.deck !== row.deck && isInDeck(next.deck, row.deck);
    out.push({ ...row, hasSubdecks, collapsed: hasSubdecks && collapsed.has(row.deck) });
  });
  return out;
}

/**
 * The deck to open after finishing `deck`: the next one down the deck list (as shown, so a
 * collapsed deck's subdecks are skipped) that has something to study. A deck's own subdecks are
 * already part of studying it, so the search starts after them. Undefined when nothing is left.
 */
export function nextDeckToStudy(rows: DeckRow[], collapsed: Set<string>, deck: string): string | undefined {
  const shown = shownDeckRows(rows, collapsed);
  const at = shown.findIndex((r) => r.deck === deck);
  if (at < 0) return undefined;
  return shown.slice(at + 1).find((r) => !isInDeck(r.deck, deck) && r.due + r.fresh > 0)?.deck;
}

/**
 * Where to go once nothing is left below `deck`: the first deck from the top of the list (as
 * shown) that has something to study. Only decks before `deck` count, and not its parents, whose
 * counts still include the cards just studied. Undefined when the top of the list has nothing.
 */
export function earlierDeckToStudy(rows: DeckRow[], collapsed: Set<string>, deck: string): string | undefined {
  const shown = shownDeckRows(rows, collapsed);
  const at = shown.findIndex((r) => r.deck === deck);
  if (at < 0) return undefined;
  return shown.slice(0, at).find((r) => !isInDeck(deck, r.deck) && r.due + r.fresh > 0)?.deck;
}

/**
 * What's waiting across the whole deck list. A top-level row's counts already include its
 * subdecks, so adding every row would count a subdeck's cards twice: only the top ones are summed.
 */
export function deckListTotals(rows: DeckRow[]): { due: number; fresh: number } {
  let due = 0;
  let fresh = 0;
  for (const r of rows) {
    if (r.depth !== 0) continue;
    due += r.due;
    fresh += r.fresh;
  }
  return { due, fresh };
}

/**
 * The deck list: every deck, nested, with what studying it would show. `listed` adds decks that
 * hold no cards (`listedDecks`): Anki lists an empty deck too. `position` orders siblings (`deckTree`).
 */
export function deckRows(input: TreeQueueInput, listed: Iterable<string> = [], position?: (deck: string) => number | undefined): DeckRow[] {
  return deckTree([...input.cardsByDeck.keys(), ...listed], position).map((node) => {
    const q = treeQueue(node.deck, input);
    let total = 0;
    let unstudied = 0;
    for (const [deck, cards] of input.cardsByDeck) {
      if (!isInDeck(deck, node.deck)) continue;
      const open = studiable(cards);
      total += open.length;
      unstudied += open.filter((c) => c.sched.state === 0).length;
    }
    const cap = input.gateFor?.(node.deck);
    const gate = cap === undefined ? undefined : { inProgress: inProgressCount(node.deck, input.cardsByDeck), cap };
    return { ...node, due: q.due.length, fresh: q.fresh.length, total, unstudied, ...(gate ? { gate } : {}) };
  });
}

/** Cards grouped by the deck each is studied in (`cardDeck`): its filtered deck, its own, else its note's. */
export function groupByDeck(cards: Card[], deckOfNote: Map<string, string>): Map<string, Card[]> {
  const out = new Map<string, Card[]>();
  for (const c of cards) {
    const deck = cardDeck(c, deckOfNote.get(c.noteId) ?? 'Imported');
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
