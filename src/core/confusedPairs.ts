/**
 * Confused words: two notes the learner mixes up, linked by hand from Review (the Again reason
 * "Mixed up with another word", or the "..." menu). Franki's own, like a miss reason: a link never
 * changes a schedule, and it isn't written into the Anki collection.
 *
 * A pair is between notes, not cards, since what gets confused is the word. It's stored with the
 * smaller note id first, so linking A to B and B to A is the same pair. Used in two places: the
 * answer side names a card's partners, and Similar words asks about them ("Your pairs",
 * src/tools/mixups.ts). Pure: the screen gathers the inputs.
 */

/** The Again reason that offers to link the word (src/core/misses.ts). Kept on review rows, so never renamed. */
export const CONFUSED_REASON = 'confused';

export interface ConfusedPair {
  /** The smaller of the two note ids. */
  a: string;
  /** The larger. */
  b: string;
  /** When the link was made (ISO). The oldest link is the one shown first. */
  linkedAt: string;
}

/** The pair for two notes, or undefined for a note linked to itself. */
export function newPair(x: string, y: string, linkedAt: Date): ConfusedPair | undefined {
  if (x === y) return undefined;
  return { a: x < y ? x : y, b: x < y ? y : x, linkedAt: linkedAt.toISOString() };
}

/** Whether two notes are linked, in either order. */
export function isLinked(pairs: readonly ConfusedPair[], x: string, y: string): boolean {
  const [a, b] = x < y ? [x, y] : [y, x];
  return pairs.some((p) => p.a === a && p.b === b);
}

/** The pairs with one more: the same list when the two are already linked. */
export function withPair(pairs: readonly ConfusedPair[], pair: ConfusedPair): ConfusedPair[] {
  return isLinked(pairs, pair.a, pair.b) ? [...pairs] : [...pairs, pair];
}

/** The pairs without the link between two notes. */
export function withoutPair(pairs: readonly ConfusedPair[], x: string, y: string): ConfusedPair[] {
  const [a, b] = x < y ? [x, y] : [y, x];
  return pairs.filter((p) => !(p.a === a && p.b === b));
}

/** Each note's partners, by note id, the earliest link first. */
export function partnerIndex(pairs: readonly ConfusedPair[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (from: string, to: string) => (out.get(from) ?? out.set(from, []).get(from)!).push(to);
  for (const p of [...pairs].sort((x, y) => x.linkedAt.localeCompare(y.linkedAt))) {
    add(p.a, p.b);
    add(p.b, p.a);
  }
  return out;
}

/** What the answer side says about a card's partners: the first, and how many more there are. */
export function partnerSummary(partners: readonly string[], known: (noteId: string) => boolean): { first: string; more: number } | undefined {
  const shown = partners.filter(known);
  return shown.length ? { first: shown[0], more: shown.length - 1 } : undefined;
}
