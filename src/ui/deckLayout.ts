import { space } from './theme';

/**
 * Where the deck list puts things. A subdeck sits in a tinted panel (a "well") inside its parent's
 * card; a well inside a well alternates tone. DeckList draws the wells and DeckRowView the rows
 * inside them, and a drag's drop line (DeckDrag.tsx) has to agree with both, so the numbers live here.
 */

/** A well's gap from the left edge of what it's in, which is also how far each level indents. */
export const WELL_INSET = space.l + space.xs;
/** A well's gap from the right edge, and the space under its last row. */
export const WELL_EDGE = space.s;
/** A row's own padding on the left, inside its card or well. */
export const ROW_PAD = space.m;
/** The round button that shows or hides subdecks, and the column it holds for sibling names to line up. */
export const DISCLOSURE = 28;

/** Where a row starts at `depth`, measured from the left edge of the deck list's card. */
export const deckRowX = (depth: number) => depth * WELL_INSET + ROW_PAD;
