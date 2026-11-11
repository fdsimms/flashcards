import { default_w, forgetting_curve } from 'ts-fsrs';
import { omnilanguageKindByOrd } from '../import/models';
import { studyDayKey } from './day';
import type { Card, StudyOrder } from './types';

/**
 * The order a study session's cards come up in, as Anki's v3 scheduler orders them (rslib
 * scheduler/queue/builder: gathering.rs, sorting.rs, intersperser.rs, and storage/card's
 * review_order_sql). Pure: deckTree.ts gathers within the limits and calls these.
 *
 * Anki's "random" orders are seeded by its day number and card mtime, which Franki doesn't keep,
 * so they're seeded by the study day here instead: the same shuffle all day, a different one the
 * next, but not the same shuffle Anki's devices show.
 */

/** Anki's defaults (deck_config.proto): mix new cards and day-long learning with reviews, gather by deck, sort by template, reviews by due date. */
export const DEFAULT_ORDER: StudyOrder = { newMix: 0, interdayLearningMix: 0, newSortOrder: 0, reviewOrder: 0, newGatherPriority: 0 };

const MIX = { withReviews: 0, afterReviews: 1, beforeReviews: 2 } as const;
const NEW_SORT = { template: 0, noSort: 1, templateThenRandom: 2, randomNoteThenTemplate: 3, randomCard: 4 } as const;
const GATHER = { deck: 0, lowestPosition: 1, highestPosition: 2, randomNotes: 3, randomCards: 4, deckThenRandomNotes: 5 } as const;
const REVIEW = {
  day: 0, dayThenDeck: 1, deckThenDay: 2, intervalsAscending: 3, intervalsDescending: 4, easeAscending: 5, easeDescending: 6,
  retrievabilityAscending: 7, random: 8, added: 9, reverseAdded: 10, retrievabilityDescending: 11, relativeOverdueness: 12,
} as const;

/** FNV-1a, 64 bits, over each value's bytes (as Anki's SQL `fnvhash` does over little-endian i64s). */
export function fnvHash(...values: (bigint | string)[]): bigint {
  const MASK = (1n << 64n) - 1n;
  let h = 0xcbf29ce484222325n;
  const step = (byte: number) => { h = ((h ^ BigInt(byte)) * 0x100000001b3n) & MASK; };
  for (const v of values) {
    if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) step(v.charCodeAt(i) & 0xff);
    } else {
      let x = BigInt.asUintN(64, v);
      for (let i = 0; i < 8; i++) { step(Number(x & 0xffn)); x >>= 8n; }
    }
  }
  return h;
}

/** A card's or note's id as Anki's number when it has one, else the id's text. */
const idValue = (id: string | undefined): bigint | string => (id && /^\d+$/.test(id) ? BigInt(id) : id ?? '');
const daySalt = (now: Date, dayStartsAtHour: number) => studyDayKey(now, dayStartsAtHour);
const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** A card's template ordinal: Anki's `ord`, from the card's kind. */
export function cardOrd(card: Card): number {
  if (card.kind.startsWith('t')) return Number(card.kind.slice(1)) || 0;
  const i = (omnilanguageKindByOrd as readonly string[]).indexOf(card.kind);
  return i < 0 ? 0 : i;
}

/**
 * Spaces `two` evenly through `one`, as Anki's Intersperser does (in f32, as there): [1,2,3]
 * with [11,22] gives 1,11,2,22,3. A tie goes to `one`.
 */
export function intersperse<T>(one: T[], two: T[]): T[] {
  const f = Math.fround;
  const ratio = f(f(one.length + 1) / f(two.length + 1));
  const out: T[] = [];
  let i1 = 0;
  let i2 = 0;
  while (i1 < one.length && i2 < two.length) {
    if (f(f(i2 + 1) * ratio) < f(i1 + 1)) out.push(two[i2++]);
    else out.push(one[i1++]);
  }
  return out.concat(one.slice(i1), two.slice(i2));
}

/** Combines `reviews` with `other` (new cards, or day-long learning) by a preset's mix option. */
export function mix<T>(reviews: T[], other: T[], how: number): T[] {
  if (how === MIX.afterReviews) return [...reviews, ...other];
  if (how === MIX.beforeReviews) return [...other, ...reviews];
  return intersperse(reviews, other);
}

export interface SortContext {
  now: Date;
  dayStartsAtHour: number;
  /** The deck each card is studied in, for deck-ordered sorts. */
  deckOf: (card: Card) => string;
  noteOf: (card: Card) => string;
  /** FSRS weights for a card's retrievability (its own deck's). */
  weightsOf: (card: Card) => number[];
}

const dayMs = 86400000;
const dueMs = (c: Card) => new Date(c.sched.due).getTime();
const studyDayOf = (c: Card, h: number) => studyDayKey(new Date(c.sched.due), h);

/** The chance of recalling a card now, by FSRS. Undefined for a card never reviewed. */
export function retrievability(card: Card, now: Date, weights: number[]): number | undefined {
  if (!card.sched.lastReview || card.sched.stability <= 0) return undefined;
  const elapsed = Math.max(0, (now.getTime() - new Date(card.sched.lastReview).getTime()) / dayMs);
  return forgetting_curve(weights.length ? weights : default_w, elapsed, card.sched.stability);
}

/**
 * Due cards (reviews, or day-long learning) in a preset's review order. Every order ends on a
 * stable shuffle, as Anki's does.
 */
export function sortReviews(cards: Card[], order: number, ctx: SortContext): Card[] {
  const salt = daySalt(ctx.now, ctx.dayStartsAtHour);
  const shuffle = new Map(cards.map((c) => [c.id, fnvHash(idValue(c.ankiId ?? c.id), salt)]));
  const r = (c: Card) => retrievability(c, ctx.now, ctx.weightsOf(c));
  // NULL first ascending, last descending, as SQLite sorts it.
  const byR = (dir: 1 | -1) => (a: Card, b: Card) => {
    const ra = r(a);
    const rb = r(b);
    if (ra === undefined || rb === undefined) return ra === rb ? 0 : (ra === undefined ? -1 : 1) * dir;
    return (ra - rb) * dir;
  };
  const overdueness = (c: Card) =>
    -(Math.floor((ctx.now.getTime() - (dueMs(c) - c.sched.scheduledDays * dayMs)) / dayMs) + 0.001) / Math.max(c.sched.scheduledDays, 1);
  const noteNum = (c: Card) => idValue(ctx.noteOf(c));
  const cmpNote = (a: Card, b: Card) => {
    const na = noteNum(a);
    const nb = noteNum(b);
    return typeof na === 'bigint' && typeof nb === 'bigint' ? cmpBig(na, nb) : String(na).localeCompare(String(nb));
  };
  const byDay = (a: Card, b: Card) => studyDayOf(a, ctx.dayStartsAtHour).localeCompare(studyDayOf(b, ctx.dayStartsAtHour));
  const byDeck = (a: Card, b: Card) => ctx.deckOf(a).localeCompare(ctx.deckOf(b));
  const keys: ((a: Card, b: Card) => number)[] = {
    [REVIEW.day]: [byDay],
    [REVIEW.dayThenDeck]: [byDay, byDeck],
    [REVIEW.deckThenDay]: [byDeck, byDay],
    [REVIEW.intervalsAscending]: [(a: Card, b: Card) => a.sched.scheduledDays - b.sched.scheduledDays],
    [REVIEW.intervalsDescending]: [(a: Card, b: Card) => b.sched.scheduledDays - a.sched.scheduledDays],
    // Under FSRS, Anki's "ease ascending" is difficulty descending, hardest first.
    [REVIEW.easeAscending]: [(a: Card, b: Card) => b.sched.difficulty - a.sched.difficulty],
    [REVIEW.easeDescending]: [(a: Card, b: Card) => a.sched.difficulty - b.sched.difficulty],
    [REVIEW.retrievabilityAscending]: [byR(1)],
    [REVIEW.retrievabilityDescending]: [byR(-1)],
    [REVIEW.relativeOverdueness]: [(a: Card, b: Card) => overdueness(a) - overdueness(b)],
    [REVIEW.random]: [],
    [REVIEW.added]: [cmpNote, (a: Card, b: Card) => cardOrd(a) - cardOrd(b)],
    [REVIEW.reverseAdded]: [(a: Card, b: Card) => -cmpNote(a, b), (a: Card, b: Card) => cardOrd(a) - cardOrd(b)],
  }[order] ?? [byDay];
  return [...cards].sort((a, b) => {
    for (const k of keys) {
      const d = k(a, b);
      if (d) return d;
    }
    return cmpBig(shuffle.get(a.id)!, shuffle.get(b.id)!);
  });
}

/**
 * New cards in a preset's gather order: deck by deck (decks in name order, parents first) or
 * across all decks at once, by position or shuffled. `admit` is asked about each card in turn and
 * decides, by the limits, whether it's taken; gathering by deck moves to the next deck once a
 * deck's own limit is spent, as Anki does.
 */
export function gatherNew(cards: Card[], priority: number, ctx: SortContext, admit: (card: Card) => boolean): Card[] {
  const salt = daySalt(ctx.now, ctx.dayStartsAtHour);
  const pos = (c: Card) => c.position ?? Number.MAX_SAFE_INTEGER;
  const byPosition = (a: Card, b: Card) => pos(a) - pos(b) || cardOrd(a) - cardOrd(b);
  const byRandomNote = (a: Card, b: Card) => cmpBig(fnvHash(idValue(ctx.noteOf(a)), salt), fnvHash(idValue(ctx.noteOf(b)), salt)) || cardOrd(a) - cardOrd(b);
  const byRandomCard = (a: Card, b: Card) => cmpBig(fnvHash(idValue(a.ankiId ?? a.id), salt), fnvHash(idValue(b.ankiId ?? b.id), salt));
  const taken: Card[] = [];
  const take = (list: Card[]) => { for (const c of list) if (admit(c)) taken.push(c); };
  if (priority === GATHER.deck || priority === GATHER.deckThenRandomNotes) {
    const decks = [...new Set(cards.map(ctx.deckOf))].sort((a, b) => a.localeCompare(b));
    for (const deck of decks) {
      take(cards.filter((c) => ctx.deckOf(c) === deck).sort(priority === GATHER.deck ? byPosition : byRandomNote));
    }
    return taken;
  }
  const sort = {
    [GATHER.lowestPosition]: byPosition,
    [GATHER.highestPosition]: (a: Card, b: Card) => pos(b) - pos(a) || cardOrd(a) - cardOrd(b),
    [GATHER.randomNotes]: byRandomNote,
    [GATHER.randomCards]: byRandomCard,
  }[priority] ?? byPosition;
  take([...cards].sort(sort));
  return taken;
}

/** The gathered new cards in a preset's sort order (Anki's sort_new, on the gathered cards only). */
export function sortNew(cards: Card[], order: number, ctx: SortContext): Card[] {
  if (order === NEW_SORT.noSort) return cards;
  const salt = daySalt(ctx.now, ctx.dayStartsAtHour);
  const cardHash = (c: Card) => fnvHash(idValue(c.ankiId ?? c.id), salt);
  const noteHash = (c: Card) => fnvHash(idValue(ctx.noteOf(c)), salt);
  const cmp = {
    [NEW_SORT.template]: (a: Card, b: Card) => cardOrd(a) - cardOrd(b),
    [NEW_SORT.templateThenRandom]: (a: Card, b: Card) => cardOrd(a) - cardOrd(b) || cmpBig(cardHash(a), cardHash(b)),
    [NEW_SORT.randomNoteThenTemplate]: (a: Card, b: Card) => cmpBig(noteHash(a), noteHash(b)) || cardOrd(a) - cardOrd(b),
    [NEW_SORT.randomCard]: (a: Card, b: Card) => cmpBig(cardHash(a), cardHash(b)),
  }[order] ?? ((a: Card, b: Card) => cardOrd(a) - cardOrd(b));
  // Array.prototype.sort is stable, so the gather order holds within equal keys, as in Anki.
  return [...cards].sort(cmp);
}
