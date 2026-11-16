import { space } from './theme';

/**
 * Where the deck list puts things. Rows aren't indented: a top-level deck with subdecks is a tinted
 * row above them, and a deck inside a subdeck names its parent under its own name. DeckRowView draws
 * the rows, and a drag's drop line (DeckDrag.tsx) has to agree with where they start, so the numbers
 * live here.
 */

/** A row's own padding on the left, inside its card. */
export const ROW_PAD = space.m;
/** The round button that shows or hides subdecks, and the column it holds at the row's right edge. */
export const DISCLOSURE = 28;
/** How far the drop line moves in for each level deeper than a top-level deck. Rows themselves don't indent: this is how a drag shows which deck it would land in. */
export const DROP_LINE_STEP = space.l;

/** Where a drag's drop line starts at `depth`, measured from the left edge of the deck list's card. */
export const deckRowX = (depth: number) => depth * DROP_LINE_STEP + ROW_PAD;
