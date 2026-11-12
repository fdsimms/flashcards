import { cardDeck, cardHomeDeck } from './deckTree';
import { retrievability } from './order';
import { formatInterval } from './scheduler';
import type { Card, Note, NoteType, ReviewLogEntry } from './types';

/**
 * Anki's Card Info, for one card: what its schedule says now, and every answer and change in its
 * history. Anki's cards read their history from the kept collection's review log (answers given
 * in Anki, AnkiMobile and Franki alike); a Franki-only card from Franki's own table.
 */

/** One row of an Anki review log, as Card Info reads it. */
export interface AnkiLogRow {
  id: number;
  ease: number;
  ivl: number;
  time: number;
  type: number;
}

export type HistoryKind = 'Learn' | 'Review' | 'Relearn' | 'Filtered' | 'Manual' | 'Rescheduled';

export interface HistoryEntry {
  at: Date;
  kind: HistoryKind;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy; 0 for a change made by hand (Forget, Set Due Date). */
  rating: number;
  /** The interval it set, e.g. "10m", "4d"; undefined when none (a card made new). */
  interval?: string;
  /** How long the answer took, where it was recorded. */
  timeMs?: number;
}

/** Anki's revlog `type`, by number (rslib's RevlogReviewKind). */
const KINDS: HistoryKind[] = ['Learn', 'Review', 'Relearn', 'Filtered', 'Manual', 'Rescheduled'];
const DAY_MS = 86_400_000;

/** A review log's interval: whole days when positive, seconds when negative, none at 0. */
function logInterval(ivl: number): string | undefined {
  if (ivl > 0) return formatInterval(ivl * DAY_MS);
  if (ivl < 0) return formatInterval(-ivl * 1000);
  return undefined;
}

/** An Anki card's history, newest first, from its review log rows. */
export function historyFromRevlog(rows: AnkiLogRow[]): HistoryEntry[] {
  return [...rows].sort((a, b) => b.id - a.id).map((r) => ({
    at: new Date(r.id),
    kind: KINDS[r.type] ?? 'Review',
    rating: r.ease,
    interval: logInterval(r.ivl),
    timeMs: r.ease > 0 ? r.time : undefined,
  }));
}

/** A Franki-only card's history, newest first, from Franki's answers. Its table records no answer time. */
export function historyFromReviews(entries: ReviewLogEntry[], cardId: string): HistoryEntry[] {
  return entries
    .filter((e) => e.cardId === cardId)
    .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
    .map((e) => {
      const at = new Date(e.reviewedAt);
      const ms = new Date(e.due).getTime() - at.getTime();
      return {
        at,
        kind: e.state === 2 ? 'Review' : e.state === 3 ? 'Relearn' : 'Learn',
        rating: e.rating,
        interval: ms > 0 ? formatInterval(ms) : undefined,
      };
    });
}

export interface CardInfo {
  /** When the card was made: an Anki card's id is its creation time. Undefined when that isn't known. */
  added?: Date;
  firstAnswer?: Date;
  latestAnswer?: Date;
  /** New: its place in the new-card order. Otherwise when it's due: a review on its study day, a step at its time. */
  due: { kind: 'new'; position?: number } | { kind: 'review' | 'learning'; at: Date };
  /** Days, for a review. */
  interval?: number;
  /** FSRS memory: stability in days, difficulty 0-100%, retrievability 0-100%. Undefined for a new card. */
  stability?: number;
  difficulty?: number;
  retrievability?: number;
  reviews: number;
  lapses: number;
  averageMs?: number;
  totalMs?: number;
  cardType: string;
  noteType: string;
  /** The deck it's studied in, and its home deck when that's another (it's in a filtered deck). */
  deck: string;
  homeDeck?: string;
  suspended: boolean;
  flag?: number;
}

/** The card's template name, as Anki's Card Info shows it. */
export function cardTypeName(card: Card, noteType: NoteType | undefined): string {
  if (card.kind === 'forward') return 'Forward';
  if (card.kind === 'reverse') return 'Reverse';
  if (card.kind === 'audio') return 'Audio';
  const ord = Number(card.kind.slice(1));
  if (noteType?.kind === 'cloze') return `Cloze ${ord + 1}`;
  return noteType?.templates.find((t) => t.ord === ord)?.name ?? `Card ${ord + 1}`;
}

export function cardInfo(card: Card, note: Note, noteType: NoteType | undefined, history: HistoryEntry[], ctx: { now: Date; weights: number[] }): CardInfo {
  const answers = history.filter((h) => h.rating > 0);
  const timed = answers.filter((h) => h.timeMs !== undefined);
  const totalMs = timed.reduce((n, h) => n + h.timeMs!, 0);
  const s = card.sched;
  const id = Number(card.ankiId);
  const home = cardHomeDeck(card, note.deck);
  const deck = cardDeck(card, note.deck);
  const r = s.state === 0 ? undefined : retrievability(card, ctx.now, ctx.weights);
  return {
    added: card.ankiId && Number.isFinite(id) ? new Date(id) : undefined,
    firstAnswer: answers.length ? answers[answers.length - 1].at : undefined,
    latestAnswer: answers.length ? answers[0].at : undefined,
    due: s.state === 0 ? { kind: 'new', position: card.position } : { kind: s.state === 2 ? 'review' : 'learning', at: new Date(s.due) },
    interval: s.state === 2 ? s.scheduledDays : undefined,
    stability: s.state === 0 ? undefined : s.stability,
    // Anki shows FSRS difficulty (1 to 10) as a percentage of its range.
    difficulty: s.state === 0 ? undefined : Math.round(((s.difficulty - 1) / 9) * 100),
    retrievability: r === undefined ? undefined : Math.round(r * 100),
    reviews: s.reps,
    lapses: s.lapses,
    averageMs: timed.length ? totalMs / timed.length : undefined,
    totalMs: timed.length ? totalMs : undefined,
    cardType: cardTypeName(card, noteType),
    noteType: note.model,
    deck,
    homeDeck: deck !== home ? home : undefined,
    suspended: card.suspended,
    flag: card.flag,
  };
}
