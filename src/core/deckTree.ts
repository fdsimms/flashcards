import { NEW_PER_DAY, REVIEWS_PER_DAY } from './config';
import { nextStudyDayStart, studyDayKey } from './day';
import { ankiToday, compareDeckNames, DEFAULT_ORDER, gatherNew, inFilteredOrder, isBehind, mix, REVIEW, sortNew, sortReviews, type SortContext } from './order';
import { aspectPartners, groupPartners } from './aspectPairs';
import { boostCap, type Boost } from './priority';
import { deckTotals, type DeckTotals } from './deckTotals';
import { isInProgress } from './progress';
import { isSkillsDeck, skillCardIds } from './skillTag';
import { dueMs, isBuried, isDue, isInterdayLearning, isLearning, studiable, type Queue, type StudiedToday } from './queue';
import { paramsForDeck } from './scheduler';
import { scaleLimits, vacationPlan, type VacationPlan, type VacationPrefs } from './vacation';
import type { BurySettings, Card, CollectionSettings, DeckParams, DeckSettings, Note, StudyOrder } from './types';
import { isAppFont, type AppFont } from './fonts';

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

/** One path part of a tier subdeck, as the MCP names them (`TIER_NAME` in server/mcp/franki_mcp/tiers.py; tests/tierDeckNames.test.ts checks they match). */
export const TIER_DECK_PART = /^Tier \d+$/;

/**
 * A frequency tier's subdeck ("Thai::Tier 1"): the MCP's tier_deck_by_frequency files a language's
 * notes into these, each on its own preset. The deck list shows the language as one deck, so a
 * path with a "Tier N" part below its top level is never listed. A top-level deck called "Tier 1"
 * is the user's own and stays; a subdeck the user made with exactly such a name is taken for a
 * tier, since nothing in Franki's own data says which subdecks the MCP made.
 */
export function isTierDeck(deck: string): boolean {
  return deck.split('::').slice(1).some((part) => TIER_DECK_PART.test(part));
}

/** The deck a tier subdeck is shown as ("Thai::Tier 2" is "Thai"); any other deck is itself. */
export function untiered(deck: string): string {
  const parts = deck.split('::');
  const at = parts.findIndex((part, i) => i >= 1 && TIER_DECK_PART.test(part));
  return at < 0 ? deck : parts.slice(0, at).join('::');
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
  /** Cards of skill notes (`skillCardIds`): outside every limit and the progress gate, and not counted by either. */
  skillCards: Set<string>;
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
  /** A deck's own daily new card limit, not today's: its preset's, else its own from Deck options (`DeckRow.newPerDay`). */
  newPerDayFor?: (deck: string) => number;
  /** Vacation mode, resolved (`vacationPlan`): paused shows nothing, likeliest first overrides the review order. The limits are scaled in `queueInput`. */
  vacation?: VacationPlan;
  /**
   * While a review from an earlier study day waits, reviews come likeliest-remembered first (`isBehind`).
   * Franki's own, set by `queueInput`; without it the review order is the preset's, as Anki builds it.
   */
  catchUp?: boolean;
  /**
   * Study each subdeck of the opened deck in one stretch (a language at a time in a Languages deck).
   * Franki's own: without it the mix is Anki's, which interleaves subdecks (the queue vectors).
   */
  batchBySubdeck?: boolean;
  /**
   * Each aspect-pair verb's partner note (`aspectPartners`, set by `queueInput`): a new card whose partner's
   * card of the same kind is also new brings it in beside it, so a pair starts the same day. Without it,
   * nothing is paired.
   */
  partnerOf?: Map<string, string>;
}

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
export function inProgressCount(root: string, cardsByDeck: Map<string, Card[]>, skillCards: Set<string>): number {
  let n = 0;
  for (const [deck, cards] of cardsByDeck) {
    if (!isInDeck(deck, root)) continue;
    for (const c of studiable(cards)) if (isInProgress(c) && !skillCards.has(c.id)) n++;
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
  return Math.max(0, Math.min(cap - inProgressCount(deck, input.cardsByDeck, input.skillCards), daily));
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
 *   cards (by the root's mix options, one subdeck at a time, in name order), then learning cards
 *   due within the learn-ahead limit.
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
  if (input.vacation?.paused) return { due: [], fresh: [], order: [], main: [] };

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
  // Asked two or three times for each card gathered, so each deck's path is worked out once.
  const paths = new Map<string, string[]>();
  const pathOf = (deck: string) => {
    let path = paths.get(deck);
    if (!path) paths.set(deck, path = deckLineage(deck).filter((d) => nodes.has(d)).reverse());
    return path;
  };
  const deckOfCard = new Map<string, string>();
  for (const d of active) for (const c of input.cardsByDeck.get(d)!) deckOfCard.set(c.id, d);
  /** Whether every deck on the card's path still has room for it. */
  const hasRoom = (card: Card, kind: 'review' | 'new'): boolean =>
    pathOf(deckOfCard.get(card.id)!).every((d) => nodes.get(d)![kind] > 0);
  /** Gives back the room `admit` took, for a card a pair's partner replaces. */
  const release = (card: Card, kind: 'review' | 'new'): void => {
    for (const d of pathOf(deckOfCard.get(card.id)!)) nodes.get(d)![kind]++;
  };
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
  const homeDeckOf = input.homeDeckOf ?? ((c: Card) => deckOfCard.get(c.id)!);
  const ctx: SortContext = {
    now, dayStartsAtHour: h, ankiToday: input.ankiToday, deckOf: (c) => deckOfCard.get(c.id)!, noteOf: (c) => c.noteId,
    weightsOf: (c) => paramsFor(homeDeckOf(c))?.weights ?? [],
    retentionOf: (c) => paramsFor(homeDeckOf(c))?.desiredRetention,
  };
  const all = active.flatMap((d) => studiable(input.cardsByDeck.get(d)!)).filter((c) => !isBuried(c, now, h) && !input.held?.has(c.id));
  // During a vacation, and while a review from an earlier study day still waits (`isBehind`), the reviews
  // likeliest to be remembered come first, but never over a filtered deck's own place order: what can't be
  // reached today is then what was already slipping, not what would have been kept.
  const order: StudyOrder = rootFiltered ? ownOrder
    : input.vacation?.likeliestFirst || (input.catchUp && isBehind(all, now, h)) ? { ...ownOrder, reviewOrder: REVIEW.retrievabilityDescending }
    : ownOrder;
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
  // A skill card's review is taken whatever room is left, and uses none (`isSkillNote`); a new one shares the words' new
  // room like any new card. Either buries its siblings as any card does.
  const skill = (c: Card) => input.skillCards.has(c.id);
  const gatherDue = (cards: Card[], kind: keyof BurySettings) =>
    // Room first, as Anki checks the limit before a card is gathered: one the limits leave out buries nothing.
    sortReviews(cards, order.reviewOrder, ctx).filter((c) => skill(c) ? !heldBack(c, kind) : hasRoom(c, 'review') && !heldBack(c, kind) && admit(c, 'review'));
  // A review in a filtered deck is due whatever its own due date: its due there is its place in the deck.
  const reviewDue = (c: Card) => c.sched.state === 2 && (inFilteredOrder(c) || isDue(c, now, h, nextDay));
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
  const gatheredNew = previewDeck ? [] : [...firstNew, ...gatherFresh(newCards.filter((c) => !firstIds.has(c.id)))];
  // Aspect pairs start together: a new card's partner (the same kind, also new, not left out by a hold or a bury) joins it.
  // The partner takes a free place if the limits leave one, else the place of the lowest-priority card that isn't half
  // of a pair, and only when every card gathered is half of a pair does it go one over the daily limit (the owner's
  // choice, 2026-11-25), so a pair never starts a day apart.
  const partnerOf = input.partnerOf;
  let gathered = [...gatheredNew];
  if (partnerOf?.size) {
    const inFresh = new Set(gathered.map((c) => c.id));
    const pairedNow = (c: Card) => { const pn = partnerOf.get(c.noteId); return !!pn && gathered.some((g) => g.noteId === pn && g.kind === c.kind); };
    for (const c of [...gathered]) {
      const pn = partnerOf.get(c.noteId);
      const other = pn ? newCards.find((x) => x.noteId === pn && x.kind === c.kind) : undefined;
      if (!other || inFresh.has(other.id) || !inFresh.has(c.id) || heldBack(other, 'new')) continue;
      let victim: Card | undefined;
      if (!hasRoom(other, 'new')) {
        victim = [...gathered].reverse().find((g) => g.id !== c.id && !pairedNow(g) && !firstIds.has(g.id));
        if (victim) {
          release(victim, 'new');
          // Still no room on the partner's own decks: keep the victim and go over instead.
          if (!hasRoom(other, 'new')) { admit(victim, 'new'); victim = undefined; }
        }
      }
      admit(other, 'new');
      inFresh.add(other.id);
      if (victim) { inFresh.delete(victim.id); gathered = gathered.filter((g) => g.id !== victim!.id); }
      gathered.push(other);
    }
  }
  // A partner joins the sort, but the boosted cards stay first: re-sorting all of them would undo the boost's order.
  const fresh = partnerOf?.size
    ? groupPartners([...gathered.filter((c) => firstIds.has(c.id)), ...sortNew(gathered.filter((c) => !firstIds.has(c.id)), order.newSortOrder, ctx)], partnerOf)
    : gathered;

  // ---- presentation ----
  const learnOrder = (a: Card, b: Card) => Number(a.sched.reps === 0) - Number(b.sched.reps === 0) || shownAt(a) - shownAt(b);
  const ahead = now.getTime() + (input.learnAheadMinutes ?? 0) * 60000;
  const learnNow = intraday.filter((c) => shownAt(c) <= now.getTime()).sort(learnOrder);
  const learnAhead = intraday.filter((c) => shownAt(c) > now.getTime() && shownAt(c) <= ahead).sort(learnOrder);
  // With `batchBySubdeck`, each subdeck of the root (a language, in a Languages deck) is studied in one stretch, in name order,
  // with its own reviews, day-long learning and new cards mixed. Learning steps due now and within the
  // learn-ahead limit stay outside the stretch, so a missed card returns whatever the language.
  const branchOf = (c: Card) => { const d = deckOfCard.get(c.id)!; return d === root ? '' : d.slice(root.length + 2).split('::')[0]; };
  const branches = [...new Set([...reviews, ...interday, ...fresh].map(branchOf))].sort(compareDeckNames);
  const inBranch = (cards: Card[], b: string) => (branches.length > 1 ? cards.filter((c) => branchOf(c) === b) : cards);
  const main = rootFiltered || !input.batchBySubdeck ? mix(mix(reviews, interday, order.interdayLearningMix), fresh, order.newMix)
    : branches.flatMap((b) => mix(mix(inBranch(reviews, b), inBranch(interday, b), order.interdayLearningMix), inBranch(fresh, b), order.newMix));
  // The mix spreads new cards among the reviews, which would part a pair: put a partner back beside its card.
  const pairedMain = partnerOf?.size ? groupPartners(main, partnerOf, new Set(fresh.map((c) => c.id))) : main;
  return {
    due: [...learnNow, ...interday, ...reviews, ...learnAhead],
    fresh,
    order: [...learnNow, ...pairedMain, ...learnAhead],
    main: pairedMain,
  };
}

/**
 * The input to `treeQueue` and `deckRows` from what the screens load: every card in the deck it's
 * studied in, each deck's limits for today and Anki settings, and the collection's settings. The
 * deck list and the review screen both build it here, so a deck never shows one count on the list
 * and another when opened.
 */
/** The app's limits, with a deck's own from Deck options over them. */
function ownDefaults(own: Partial<DeckLimits> | undefined): DeckLimits {
  return { newPerDay: own?.newPerDay ?? NEW_PER_DAY, reviewsPerDay: own?.reviewsPerDay ?? REVIEWS_PER_DAY };
}

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
  /**
   * A deck's own limits from Deck options, for a deck with no Anki preset to take them from
   * (`DeckSettings.newPerDay` / `reviewsPerDay`). Required, so every caller decides.
   */
  ownLimitsFor: (deck: string) => Partial<DeckLimits> | undefined;
  /** Tagged cards first (`boostFor`). */
  boostFor?: (root: string) => Boost | undefined;
  /** Vacation mode's setting (`VacationPrefs`), resolved here so the deck list and the review screen both apply it. */
  vacation?: VacationPrefs;
  /** Study each subdeck in one stretch (`DeckSettings.batchBySubdeck`, read for the deck being opened). */
  batchBySubdeck?: boolean;
}): TreeQueueInput {
  const deckOfNote = new Map([...a.notes].map((n) => [n.id, n.deck]));
  const todayKey = studyDayKey(a.now, a.collection.dayStartsAtHour);
  const vacation = vacationPlan(a.vacation, a.now, a.collection.dayStartsAtHour);
  return {
    cardsByDeck: groupByDeck(a.cards, deckOfNote),
    skillCards: skillCardIds(a.notes, a.cards),
    limitsFor: (d) => {
      const p = paramsForDeck(d, a.params);
      const limits = deckLimits(p, ownDefaults(a.ownLimitsFor(d)), todayKey);
      return scaleLimits(limits, vacation, { new: p?.newLimitToday?.day === todayKey, review: p?.reviewLimitToday?.day === todayKey });
    },
    paramsFor: (d) => paramsForDeck(d, a.params),
    newPerDayFor: (d) => paramsForDeck(d, a.params)?.newPerDay ?? ownDefaults(a.ownLimitsFor(d)).newPerDay,
    homeDeckOf: (c) => cardHomeDeck(c, deckOfNote.get(c.noteId) ?? 'Imported'),
    studiedByDeck: a.studied,
    catchUp: true,
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
    batchBySubdeck: a.batchBySubdeck,
    partnerOf: aspectPartners(a.notes),
  };
}

export interface DeckRow extends DeckNode {
  due: number;
  fresh: number;
  /** Cards that can be studied in the deck and its subdecks. */
  total: number;
  /** Cards in the deck and its subdecks that were never studied and aren't suspended: all of them, not just today's new cards. */
  unstudied: number;
  /** Every card in the deck and its subdecks, suspended or buried too: 0 is a deck with nothing in it yet. Missing from a row kept from before it was counted. */
  cards?: number;
  /** The deck's and its subdecks' cards and notes by state (`deckTotals`). Missing from a row kept from before it was counted. */
  totals?: DeckTotals;
  /** For a gated deck: cards in progress under it, and its cap. */
  gate?: { inProgress: number; cap: number };
  /**
   * The deck's own daily new card limit, from its preset (or the app's default), not today's: no
   * Custom Study limit for today and no vacation scaling. With `unstudied`, how many days of new
   * cards it has left (src/reader/newWords.ts). Missing from a row kept from before it was counted.
   */
  newPerDay?: number;
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
 * The Today tab's decks: the deck list's rows trimmed to the decks with something due or new
 * today. A deck stays when it or a deck inside it has cards today, so a subdeck is never shown
 * without the decks above it, and a deck whose subdecks all have nothing loses its show/hide
 * button. Collapsed decks hide their subdecks here as on the deck list. A skills subdeck
 * (`isSkillsDeck`) never keeps a deck on the list: its cards are practice offered inside the language
 * deck, so a deck with only skill cards left is done for the day. It still shows under a deck that is
 * listed for its own cards.
 */
export function todayDeckRows<R extends DeckNode & { due: number; fresh: number }>(rows: R[], collapsed: Set<string>) {
  const busy = rows.filter((r) => r.due + r.fresh > 0 && !isSkillsDeck(r.deck));
  const listed = rows.filter((r) => busy.some((b) => isInDeck(b.deck, r.deck)));
  const skillsUnderListed = rows.filter((r) => isSkillsDeck(r.deck) && r.due + r.fresh > 0 && listed.some((l) => l.deck !== r.deck && isInDeck(r.deck, l.deck)));
  return shownDeckRows(rows.filter((r) => listed.includes(r) || skillsUnderListed.includes(r)), collapsed);
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
  // A tier subdeck has no row of its own, but its cards still count in every deck above it: the counts
  // below are taken over all of `input`, not over the rows that are shown.
  const byHome = new Map<string, Card[]>();
  for (const [deck, cards] of input.cardsByDeck) {
    for (const c of cards) {
      const h = input.homeDeckOf ? input.homeDeckOf(c) : deck;
      (byHome.get(h) ?? byHome.set(h, []).get(h)!).push(c);
    }
  }
  return deckTree([...input.cardsByDeck.keys(), ...listed], position).filter((node) => !isTierDeck(node.deck)).map((node) => {
    const q = treeQueue(node.deck, input);
    let total = 0;
    let unstudied = 0;
    let all = 0;
    for (const [deck, cards] of input.cardsByDeck) {
      if (!isInDeck(deck, node.deck)) continue;
      all += cards.filter((c) => !c.retired).length;
      const open = studiable(cards);
      total += open.length;
      unstudied += open.filter((c) => c.sched.state === 0 && !input.skillCards.has(c.id)).length;
    }
    const cap = input.gateFor?.(node.deck);
    const gate = cap === undefined ? undefined : { inProgress: inProgressCount(node.deck, input.cardsByDeck, input.skillCards), cap };
    const newPerDay = input.newPerDayFor?.(node.deck) ?? input.paramsFor?.(node.deck)?.newPerDay ?? NEW_PER_DAY;
    // By the deck a card came from, not a filtered deck it's in: a deck's totals are its own notes.
    const home: Card[] = [];
    for (const [deck, cards] of byHome) if (isInDeck(deck, node.deck)) for (const c of cards) home.push(c);
    const totals = deckTotals(home, input.skillCards, input.now ?? new Date(), input.dayStartsAtHour);
    return { ...node, due: q.due.length, fresh: q.fresh.length, total, unstudied, cards: all, totals, newPerDay, ...(gate ? { gate } : {}) };
  });
}

/**
 * Reviews due today under `root` that a lookalike seen lately holds back until tomorrow (`heldCards`,
 * lookalikes.ts). Held new cards aren't counted: others take their place within the day's limit.
 */
export function heldDue(root: string, cardsByDeck: Map<string, Card[]>, held: Set<string> | undefined, now: Date, dayStartsAtHour: number): number {
  if (!held?.size) return 0;
  let n = 0;
  for (const [deck, cards] of cardsByDeck) {
    if (!isInDeck(deck, root)) continue;
    for (const c of studiable(cards)) {
      if (held.has(c.id) && c.sched.state === 2 && !isBuried(c, now, dayStartsAtHour) && isDue(c, now, dayStartsAtHour)) n++;
    }
  }
  return n;
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

/** The fonts a deck's cards cycle through: its own list, else its nearest ancestor's; none means the app's font. */
export function deckCardFonts(deck: string, all: Map<string, DeckSettings>): AppFont[] {
  return (inheritedSetting(deck, all, 'cardFonts') ?? []).filter(isAppFont);
}
