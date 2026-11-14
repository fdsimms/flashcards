import { default_w, forgetting_curve } from 'ts-fsrs';
import { omnilanguageKindByOrd } from '../import/models';
import { studyDayKey, studyDayStart } from './day';
import type { Card, StudyOrder } from './types';

/**
 * The order a study session's cards come up in, as Anki's v3 scheduler orders them (rslib
 * scheduler/queue/builder: gathering.rs, sorting.rs, intersperser.rs, and storage/card's
 * review_order_sql). Pure: deckTree.ts gathers within the limits and calls these.
 *
 * Anki's "random" orders are seeded as Anki seeds them: by its day number (`ankiToday`) and, for
 * reviews, the card's id and last change (`Card.ankiMod`), hashed with FNV-1a, compared signed
 * where Anki sorts in SQL and unsigned where it sorts in Rust. A card that never came from Anki,
 * or a collection whose creation time isn't known, falls back to a seed from the study day.
 */

/** Anki's defaults (deck_config.proto): mix new cards and day-long learning with reviews, gather by deck, sort by template, reviews by due date. */
export const DEFAULT_ORDER: StudyOrder = { newMix: 0, interdayLearningMix: 0, newSortOrder: 0, reviewOrder: 0, newGatherPriority: 0 };

const MIX = { withReviews: 0, afterReviews: 1, beforeReviews: 2 } as const;
const NEW_SORT = { template: 0, noSort: 1, templateThenRandom: 2, randomNoteThenTemplate: 3, randomCard: 4 } as const;
const GATHER = { deck: 0, lowestPosition: 1, highestPosition: 2, randomNotes: 3, randomCards: 4, deckThenRandomNotes: 5 } as const;
export const REVIEW = {
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
const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
/** As SQLite sorts Anki's `fnvhash()`: the signed 64-bit value. */
const signed = (h: bigint) => BigInt.asIntN(64, h);

/**
 * Anki's day number for `now` (`sched.today`), as rslib's timing does it (`days_elapsed` in
 * scheduler/timing.rs): the calendar days between the date the collection was created on, dated
 * in the time zone it was created in (`creationOffset`, minutes west), and today's study day here.
 * The creation's date is taken as it is, with no rollover subtracted: Anki stamps `crt` at 4 AM
 * whatever "Next day starts at" says. Undefined without the creation time.
 */
export function ankiToday(now: Date, dayStartsAtHour: number, collectionCreated: number | undefined, creationOffset?: number): number | undefined {
  if (collectionCreated === undefined) return undefined;
  const [y, m, d] = studyDayKey(now, dayStartsAtHour).split('-').map(Number);
  const created = createdDate(collectionCreated, creationOffset);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate())) / 86400000);
}

/**
 * When Anki's day number `day` starts here: the start of the study day `ankiToday` gives that
 * number, so a card Anki has due on that day is due here from then. Counted in calendar days, so
 * a daylight saving change in between doesn't move it into the day before or after.
 */
export function ankiDayStart(day: number, dayStartsAtHour: number, collectionCreated: number, creationOffset?: number): Date {
  const created = createdDate(collectionCreated, creationOffset);
  return new Date(created.getUTCFullYear(), created.getUTCMonth(), created.getUTCDate() + day, dayStartsAtHour);
}

/** The collection's creation as the wall clock read in its own time zone, through the Date's UTC fields. */
function createdDate(collectionCreated: number, creationOffset?: number): Date {
  const west = creationOffset ?? new Date(collectionCreated * 1000).getTimezoneOffset();
  return new Date((collectionCreated - west * 60) * 1000);
}

/** Anki's `knuth_salt`: the day number times 2654435761, as a wrapping u32. */
const knuthSalt = (today: number) => BigInt.asUintN(32, BigInt(today) * 2654435761n);

/** Deck names as Anki orders them: by its stored name (levels joined by \x1f), case-insensitive, by code point. */
export function compareDeckNames(a: string, b: string): number {
  const fold = (s: string) => Array.from(s.split('::').join('\x1f').toLowerCase(), (ch) => ch.codePointAt(0)!);
  const fa = fold(a);
  const fb = fold(b);
  for (let i = 0; i < Math.min(fa.length, fb.length); i++) if (fa[i] !== fb[i]) return fa[i] - fb[i];
  return fa.length - fb.length;
}

/** Anki's card ids in ascending order: SQLite's scan order, the last tie-break of its queries. */
const byCardId = (a: Card, b: Card) => {
  const ia = idValue(a.ankiId ?? a.id);
  const ib = idValue(b.ankiId ?? b.id);
  return typeof ia === 'bigint' && typeof ib === 'bigint' ? cmpBig(ia, ib) : String(ia).localeCompare(String(ib));
};

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
  /** Anki's day number (`ankiToday`), for its seeds. */
  ankiToday?: number;
  /** The deck each card is studied in, for deck-ordered sorts. */
  deckOf: (card: Card) => string;
  noteOf: (card: Card) => string;
  /** FSRS weights for a card's retrievability (its own deck's). */
  weightsOf: (card: Card) => number[];
}

const dayMs = 86400000;
const dueMs = (c: Card) => new Date(c.sched.due).getTime();

/**
 * A card in a filtered deck takes its place in that deck's order as its due (Anki stores it
 * from -100000 up), so it's due now and sorts ahead of every ordinary card, in the deck's order.
 */
export const inFilteredOrder = (c: Card) => c.filteredDue !== undefined && c.filteredDue < 0;

/** The day a card is due on, as a number to sort by: its filtered-deck place, else its study day. */
function dueDay(c: Card, h: number): number {
  if (inFilteredOrder(c)) return c.filteredDue!;
  // The local date as a day number: dividing the local instant by a day's milliseconds lands on
  // .5 in some zones (UTC-8 with a 4 AM rollover), where rounding gave two days the same number.
  const d = studyDayStart(new Date(c.sched.due), h);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / dayMs;
}

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
  // Anki's last key for every review order: fnvhash(id, mod), sorted signed.
  const shuffle = new Map(cards.map((c) => [c.id, c.ankiId && c.ankiMod !== undefined
    ? signed(fnvHash(BigInt(c.ankiId), BigInt(c.ankiMod)))
    : signed(fnvHash(idValue(c.ankiId ?? c.id), studyDayKey(ctx.now, ctx.dayStartsAtHour)))]));
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
  const byDay = (a: Card, b: Card) => dueDay(a, ctx.dayStartsAtHour) - dueDay(b, ctx.dayStartsAtHour);
  const byDeck = (a: Card, b: Card) => compareDeckNames(ctx.deckOf(a), ctx.deckOf(b));
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
  // Anki's SQL seeds these with knuth_salt(today) and sorts the hash signed.
  const salt: bigint | string = ctx.ankiToday !== undefined ? knuthSalt(ctx.ankiToday) : studyDayKey(ctx.now, ctx.dayStartsAtHour);
  const hash = (id: string | undefined) => signed(fnvHash(idValue(id), salt));
  const pos = (c: Card) => (inFilteredOrder(c) ? c.filteredDue! : c.position) ?? Number.MAX_SAFE_INTEGER;
  const byPosition = (a: Card, b: Card) => pos(a) - pos(b) || cardOrd(a) - cardOrd(b) || byCardId(a, b);
  const byRandomNote = (a: Card, b: Card) => cmpBig(hash(ctx.noteOf(a)), hash(ctx.noteOf(b))) || cardOrd(a) - cardOrd(b) || byCardId(a, b);
  const byRandomCard = (a: Card, b: Card) => cmpBig(hash(a.ankiId ?? a.id), hash(b.ankiId ?? b.id)) || byCardId(a, b);
  const taken: Card[] = [];
  const take = (list: Card[]) => { for (const c of list) if (admit(c)) taken.push(c); };
  if (priority === GATHER.deck || priority === GATHER.deckThenRandomNotes) {
    const decks = [...new Set(cards.map(ctx.deckOf))].sort(compareDeckNames);
    for (const deck of decks) {
      take(cards.filter((c) => ctx.deckOf(c) === deck).sort(priority === GATHER.deck ? byPosition : byRandomNote));
    }
    return taken;
  }
  const sort = {
    [GATHER.lowestPosition]: byPosition,
    [GATHER.highestPosition]: (a: Card, b: Card) => pos(b) - pos(a) || cardOrd(a) - cardOrd(b) || byCardId(a, b),
    [GATHER.randomNotes]: byRandomNote,
    [GATHER.randomCards]: byRandomCard,
  }[priority] ?? byPosition;
  take([...cards].sort(sort));
  return taken;
}

/** The gathered new cards in a preset's sort order (Anki's sort_new, on the gathered cards only). */
export function sortNew(cards: Card[], order: number, ctx: SortContext): Card[] {
  if (order === NEW_SORT.noSort) return cards;
  // Anki's sort_new hashes [id, today] in Rust and compares unsigned.
  const salt: bigint | string = ctx.ankiToday !== undefined ? BigInt(ctx.ankiToday) : studyDayKey(ctx.now, ctx.dayStartsAtHour);
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
