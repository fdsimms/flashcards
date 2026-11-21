import { nextCard, type Queue, type StudiedToday } from './queue';
import type { AnkiActionUndo } from '../anki/cardUndo';
import type { AnkiUndo } from '../anki/writeback';
import type { RatingValue } from './scheduler';
import type { Card, DeckParams } from './types';

/** Anki's "Maximum answer seconds" for a deck without a preset. */
const DEFAULT_MAX_ANSWER_SECS = 60;

/**
 * The time one answer records: how long the card was up, capped at the card's preset's "Maximum
 * answer seconds" as Anki's `Card.time_taken` caps it, so a phone put down mid-card doesn't count.
 * The review log, the deck's studied-today time and the session summary all use this.
 */
export function answerTimeMs(shownForMs: number, params: Pick<DeckParams, 'maxAnswerSecs'> | undefined): number {
  return Math.max(0, Math.min(shownForMs, (params?.maxAnswerSecs ?? DEFAULT_MAX_ANSWER_SECS) * 1000));
}

/**
 * Bookkeeping for one review session, kept out of the screen so it can be tested: today's counts
 * as answers are given and taken back, and which card to show after an undo.
 */

/**
 * Today's counts after an answer (`delta` 1) or its undo (-1) on a card in `deck`, by what the
 * answer used of the limits (`AnswerRecord.counts`, from `answerCounts`): the same rule `studiedToday`
 * counts by, so an undo takes back exactly what the answer added.
 */
export function bumpStudied(
  studied: Map<string, StudiedToday>,
  deck: string,
  kind: 'new' | 'review' | 'skillNew' | null,
  delta: 1 | -1,
): Map<string, StudiedToday> {
  if (!kind) return studied;
  const out = new Map(studied);
  const s = out.get(deck) ?? { introduced: 0, reviewed: 0 };
  const skillIntroduced = Math.max(0, (s.skillIntroduced ?? 0) + (kind === 'skillNew' ? delta : 0));
  out.set(deck, {
    introduced: Math.max(0, s.introduced + (kind === 'new' ? delta : 0)),
    reviewed: Math.max(0, s.reviewed + (kind === 'review' ? delta : 0)),
    ...(skillIntroduced ? { skillIntroduced } : {}),
  });
  return out;
}

/** One answer, enough to take it back. */
export interface AnswerRecord {
  /** The card as it was before the answer. */
  before: Card;
  /** The review log row the answer wrote. Set once the answer is written, which Review does behind showing the next card. */
  reviewId?: number;
  /** The card's own deck (not the one being studied, which may be its parent). */
  deck: string;
  /** What undoes the answer in the kept Anki collection, when the card is from one. Set with `reviewId`. */
  anki?: AnkiUndo;
  /** The rating given, and how long the card was on screen before it, for the session's summary. */
  rating: RatingValue;
  takenMs: number;
  /** Siblings the answer buried (`siblingsToBury`), as they were before: undo puts them back. */
  buried: Card[];
  /** The note the answer tagged as a leech: undo takes the tag back off, leaving anything edited since (a hint). */
  leechNoteId?: string;
  /** The note whose leech tag the answer took off (`leechRecovered`): undo puts it back. */
  leechClearedNoteId?: string;
  /** An answer in a filtered deck that only previews. */
  preview?: boolean;
  /** What the answer used of today's limits (`answerCounts`), worked out once, so undo takes back the same. */
  counts: 'new' | 'review' | 'skillNew' | null;
  /** What went wrong, chosen from Again's menu (misses.ts), for the session end's list of misses. */
  miss?: string;
}

/**
 * Something Review's menu did to cards, enough to take it back (`undoCardAction`, src/anki/cardUndo.ts).
 * `state` is a bury, suspend or flag; `schedule` is Set Due Date or Forget, which change the schedule too.
 */
export interface CardAction {
  kind: 'state' | 'schedule';
  /** What was done, as the undo offer says it ("Suspended this card"). */
  label: string;
  /** The cards as they were before. */
  before: Card[];
  /** What undoes it in the kept Anki collection, when it changed cards there. */
  anki?: AnkiActionUndo;
  /** How many answers stood in the session's history when it was done: an answer given after it is undone first. */
  afterAnswers: number;
}

/**
 * Which comes off first when Undo is tapped: the latest menu action or the latest answer, as Anki's
 * undo takes back the latest thing done whichever kind it was. `answers` is how many answers
 * stand in the history. Null when there's nothing to undo.
 */
export function nextUndo(answers: number, actions: readonly CardAction[]): 'action' | 'answer' | null {
  const last = actions[actions.length - 1];
  if (last && last.afterAnswers >= answers) return 'action';
  if (answers > 0) return 'answer';
  return last ? 'action' : null;
}

/**
 * A card as it was before a menu action (`before`), put over the card as it is now (`live`): the
 * fields the action can change go back, and the rest stays as it is now. A bury, suspend or flag
 * changes only the card's state; Set Due Date and Forget change its schedule and bring it home too.
 */
export function restoreCard(live: Card, before: Card, kind: CardAction['kind']): Card {
  const state = { ...live, suspended: before.suspended, buriedAt: before.buriedAt, flag: before.flag, ankiMod: before.ankiMod };
  if (kind === 'state') return state;
  return {
    ...state, sched: before.sched, position: before.position,
    filteredDeck: before.filteredDeck, filteredDue: before.filteredDue, previewDue: before.previewDue,
  };
}

/**
 * Anki's session time limit (its timebox, Preferences, Review): reached once `limitSecs` have
 * passed since the stretch started at `startMs`. Anki checks it after each answer. Never reached
 * with no limit (0, Anki's default).
 */
export function timeboxReached(startMs: number, nowMs: number, limitSecs: number | undefined): boolean {
  return !!limitSecs && limitSecs > 0 && nowMs - startMs >= limitSecs * 1000;
}

/** What the time limit alert says: "You studied 34 cards in 15 minutes." */
export function timeboxMessage(cards: number, ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `You studied ${cards} ${cards === 1 ? 'card' : 'cards'} in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

/**
 * The answer timer's reading, as Anki's reviewer shows it: the seconds the card has been up,
 * stopped at the preset's maximum answer seconds (`capped` then, which Anki shows in red), and
 * held at the moment the answer was shown when the preset says to stop it then.
 */
export function answerTimer(
  shownAtMs: number, nowMs: number, revealedAtMs: number | undefined,
  params: Pick<DeckParams, 'maxAnswerSecs' | 'stopTimerOnAnswer'> | undefined,
): { secs: number; capped: boolean } {
  const until = params?.stopTimerOnAnswer && revealedAtMs !== undefined ? Math.min(nowMs, revealedAtMs) : nowMs;
  const max = params?.maxAnswerSecs ?? DEFAULT_MAX_ANSWER_SECS;
  const secs = Math.max(0, Math.floor((until - shownAtMs) / 1000));
  return secs >= max ? { secs: max, capped: true } : { secs, capped: false };
}

/** "0:07", "1:00": minutes and seconds. */
export function clockText(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/** How far through the session is: answers given over those plus the cards still queued. */
export function sessionProgress(answered: number, remaining: number): number {
  const total = answered + remaining;
  return total > 0 ? answered / total : 0;
}

export interface SessionSummary {
  answered: number;
  /** Answers that were Again. */
  again: number;
  takenMs: number;
}

/** What to say when the session ends, from the answers still standing (an undone one isn't in `history`). */
export function sessionSummary(history: AnswerRecord[]): SessionSummary {
  return {
    answered: history.length,
    again: history.filter((a) => a.rating === 1).length,
    takenMs: history.reduce((sum, a) => sum + a.takenMs, 0),
  };
}

/** How far a card has to be dragged sideways, in points, for letting go to answer it. */
export const SWIPE_DISTANCE = 110;
/** A quick flick (points per millisecond) needs only this much distance. */
const FLICK_VELOCITY = 0.8;
const FLICK_DISTANCE = 40;

/**
 * The rating a sideways drag means when let go: right is Good, left is Again. Null when it's too
 * short to count, or when that rating isn't one of the answer buttons shown, so a swipe never
 * gives an answer the buttons wouldn't.
 */
export function swipeRating(dx: number, vx: number, shown: RatingValue[]): RatingValue | null {
  const far = Math.abs(dx) >= SWIPE_DISTANCE || (Math.abs(dx) >= FLICK_DISTANCE && Math.abs(vx) >= FLICK_VELOCITY && Math.sign(vx) === Math.sign(dx));
  if (!far) return null;
  const rating: RatingValue = dx > 0 ? 3 : 1;
  return shown.includes(rating) ? rating : null;
}

/**
 * The card to show: the one just brought back by an undo when it's in the queue, as Anki does,
 * else the queue's next.
 */
export function currentCard(queue: Queue, preferId?: string): Card | undefined {
  if (preferId) {
    const preferred = queue.order.find((c) => c.id === preferId);
    if (preferred) return preferred;
  }
  return nextCard(queue);
}

/**
 * `next`, a queue rebuilt after an answer or an edit, with its mixed stretch (`Queue.main`) in the
 * order `prev`, the queue before it, had it in. Review rebuilds the queue after every answer, and
 * the mix (`intersperse`, order.ts) spaces new cards by how many cards are left: rebuilt each time,
 * the card on top is a new one only once fewer reviews are left than new cards, so 150 reviews
 * came before the first new card. Anki builds the queue once and takes cards off it; this gives
 * the same: a card still queued keeps its place, one that left (answered, buried, held) is dropped,
 * and one that wasn't queued before (an undone answer, a card come due, extra new cards from Custom
 * Study) goes after the card before it in the rebuilt order, or first when it has none. The learning
 * steps around the mixed stretch are timed, so they come from `next` as they are.
 */
export function keepSessionOrder(prev: Queue | undefined, next: Queue): Queue {
  if (!prev || !prev.main.length || !next.main.length) return next;
  const nextById = new Map(next.main.map((c) => [c.id, c]));
  // The cards as `next` has them (an answer or an edit changed some), in `prev`'s places.
  const kept = prev.main.filter((c) => nextById.has(c.id)).map((c) => nextById.get(c.id)!);
  if (!kept.length) return next;
  let main = kept;
  if (kept.length < next.main.length) {
    const placed = new Set(kept.map((c) => c.id));
    main = [...kept];
    next.main.forEach((c, i) => {
      if (placed.has(c.id)) return;
      const before = i > 0 ? main.findIndex((m) => m.id === next.main[i - 1].id) : -1;
      main.splice(before + 1, 0, c);
    });
  }
  const start = next.order.indexOf(next.main[0]);
  return { ...next, main, order: [...next.order.slice(0, start), ...main, ...next.order.slice(start + next.main.length)] };
}

/**
 * The card most likely shown after `current` is answered: the queue's next card besides it and
 * those the answer will leave out of the rebuilt queue (`leavesOut`: siblings it buries, lookalikes
 * it holds back). Review loads its page ahead, and once the answer is given shows it before the
 * queue is rebuilt, holding it there (`preferId`) so the rebuilt queue can't swap it. Undefined when
 * nothing else is queued: the card may come straight back, or the session end.
 */
export function upNext(queue: Queue, current: Card | undefined, leavesOut?: (card: Card) => boolean): Card | undefined {
  return queue.order.find((c) => c.id !== current?.id && !leavesOut?.(c));
}
