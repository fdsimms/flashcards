/**
 * Mini cram: a card marked during a review comes back a few more times in the same session, so a
 * word you want to hold on to today gets seen again. It is practice, never a rating: the card's
 * own answer (the one the answer buttons give) reaches FSRS once, as always, and a return is
 * answered with Missed it / Got it, which write no review row, change no counts and are not in
 * undo. Nothing here imports anything that schedules (`tests/core/miniCram.test.ts`).
 *
 * The clock is `passes`: every card answered or returned since the session began. A return is due
 * when `passes` reaches the entry's `at`, so spacing follows how many other cards went by, and
 * stays in step with a deck that has few cards left.
 */

/** How many times a marked card comes back after its own answer. */
export const CRAM_RETURNS = 3;
/** Cards between one showing and the next return: about 3, 7 and 12 cards after the answer. */
export const RETURN_GAPS = [3, 4, 5] as const;
/** After Missed it, the same return comes back this many passes later and doesn't use up a return. */
export const MISSED_GAP = 2;

export interface MiniCramEntry {
  /** Returns still to come. */
  left: number;
  /** The pass on which the next return is due. */
  at: number;
  /** Whether the card has been answered since it was marked: that first answer starts the returns and isn't one. */
  based: boolean;
}

export interface MiniCram {
  passes: number;
  cards: Record<string, MiniCramEntry>;
}

export const emptyMiniCram = (): MiniCram => ({ passes: 0, cards: {} });

const gapAfter = (left: number) => RETURN_GAPS[Math.min(CRAM_RETURNS - left, RETURN_GAPS.length - 1)];

/** Marks a card. `answered` is whether it has already been answered this session: the returns then start from now. */
export function markCram(s: MiniCram, id: string, answered: boolean): MiniCram {
  if (s.cards[id]) return s;
  const entry: MiniCramEntry = { left: CRAM_RETURNS, at: s.passes + gapAfter(CRAM_RETURNS), based: answered };
  return { ...s, cards: { ...s.cards, [id]: entry } };
}

export function unmarkCram(s: MiniCram, id: string): MiniCram {
  if (!s.cards[id]) return s;
  const { [id]: _gone, ...rest } = s.cards;
  return { ...s, cards: rest };
}

function settle(s: MiniCram, id: string, passes: number, got: boolean): MiniCram {
  const e = s.cards[id];
  if (!e) return { ...s, passes };
  if (!got) return { passes, cards: { ...s.cards, [id]: { ...e, at: passes + MISSED_GAP } } };
  const left = e.left - 1;
  if (left <= 0) return { passes, cards: unmarkCram(s, id).cards };
  return { passes, cards: { ...s.cards, [id]: { ...e, left, at: passes + gapAfter(left) } } };
}

/**
 * A real answer to `id` (a rating from the answer buttons). The first one after the card was marked
 * starts the returns; a later one (the card coming up again as a learning step) counts as a return
 * if it wasn't Again.
 */
export function afterAnswer(s: MiniCram, id: string, rating: number): MiniCram {
  const passes = s.passes + 1;
  const e = s.cards[id];
  if (!e) return { ...s, passes };
  if (!e.based) return { passes, cards: { ...s.cards, [id]: { ...e, based: true, at: passes + gapAfter(e.left) } } };
  return settle(s, id, passes, rating > 1);
}

/** A return answered: Got it uses one up, Missed it brings the card back soon. */
export function afterReturn(s: MiniCram, id: string, got: boolean): MiniCram {
  return settle(s, id, s.passes + 1, got);
}

/**
 * The card whose return comes next, or undefined. Only cards whose answer has been given and that
 * `usable` allows (still studiable). Normally one whose pass has come; with `ignoreWait`, because
 * nothing else is queued, the soonest, so the session never ends with returns unseen. A card isn't
 * returned straight after it was shown (`justShown`) unless it's the only one left.
 */
export function nextReturn(s: MiniCram, opts: { ignoreWait: boolean; justShown?: string; usable?: (id: string) => boolean }): string | undefined {
  const ready = Object.entries(s.cards)
    .filter(([id, e]) => e.based && (opts.ignoreWait || e.at <= s.passes) && (opts.usable?.(id) ?? true))
    .sort((a, b) => a[1].at - b[1].at);
  return (ready.find(([id]) => id !== opts.justShown) ?? ready[0])?.[0];
}
