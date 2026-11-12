import { deckLineage, isInDeck } from './deckTree';

/**
 * Moving a deck by dragging it on the deck list: where a drop lands (`deckDropTarget`), and what
 * landing there means (`deckMove`). A drop puts the deck between two rows, at a depth the finger
 * picks by moving sideways, so one gesture reorders, nests (into the deck above) and unnests.
 *
 * Changing parent is a rename ("Odmiana" dropped under Polski is "Polski::Odmiana"), which Anki
 * follows (`renameDeck`). The order among siblings is Franki's own (`DeckSettings.position`):
 * Anki lists decks by name and has nowhere to keep another order, so AnkiMobile and Anki on the
 * computer still list them A to Z.
 */

/** A row on screen, where it rests: its top and height in the list's content. */
export interface RowSlot {
  deck: string;
  depth: number;
  top: number;
  height: number;
}

/** Where a drop lands: after the row `after` (null for the very top), at `depth`. */
export interface DeckDropTarget {
  after: string | null;
  depth: number;
  /** Where to draw the line that shows it: between the two rows, in content coordinates. */
  lineY: number;
}

/**
 * The drop for a dragged card whose middle is at `centerY`, with the finger asking for
 * `wantDepth`. The dragged deck and the subdecks that move with it are left out: a deck can't go
 * inside itself. The gap is the one the card's middle is nearest, by the rows' midpoints, and the
 * depth is held to what that gap allows: as deep as a child of the row above, as shallow as the row
 * below (which would otherwise end up inside the dropped deck).
 */
export function deckDropTarget(rows: RowSlot[], dragged: string, centerY: number, wantDepth: number): DeckDropTarget {
  const others = rows.filter((r) => !isInDeck(r.deck, dragged));
  let i = 0;
  while (i < others.length && others[i].top + others[i].height / 2 < centerY) i++;
  const above = others[i - 1];
  const below = others[i];
  const max = above ? above.depth + 1 : 0;
  const min = below ? Math.min(below.depth, max) : 0;
  const depth = Math.max(min, Math.min(max, Math.round(wantDepth)));
  const lineY = above && below
    ? (above.top + above.height + below.top) / 2
    : above ? above.top + above.height : below ? below.top : 0;
  return { after: above?.deck ?? null, depth, lineY };
}

/** What a move does: `from` becomes `to`, and `order` is its new parent's subdecks, in order. */
export interface DeckMove {
  from: string;
  to: string;
  parent: string | null;
  /** Every deck directly under `parent` (top-level decks when null), `to` among them. */
  order: string[];
}

const depthOf = (deck: string) => deck.split('::').length - 1;
const parentOf = (deck: string) => (deck.includes('::') ? deck.slice(0, deck.lastIndexOf('::')) : null);
const leafOf = (deck: string) => deck.split('::').pop()!;

/** The decks directly under `parent`, in the order `decks` (the deck list's, every deck) has them. */
function childrenOf(decks: string[], parent: string | null): string[] {
  return decks.filter((d) => parentOf(d) === parent);
}

/**
 * The move a drop makes: `dragged` dropped after the row `after`, at `depth`. `decks` is every
 * deck in the deck list's order, collapsed ones' subdecks included. Null when the drop leaves the
 * deck where it was, or can't be made (a drop inside the deck itself, or deeper than the row above
 * allows: `deckDropTarget` never gives either).
 */
export function deckMove(decks: string[], dragged: string, after: string | null, depth: number): DeckMove | null {
  if (after !== null && isInDeck(after, dragged)) return null;
  if (depth < 0 || depth > (after === null ? 0 : depthOf(after) + 1)) return null;
  const parent = depth === 0 ? null : deckLineage(after!)[depth - 1];
  const to = parent === null ? leafOf(dragged) : `${parent}::${leafOf(dragged)}`;
  const siblings = childrenOf(decks, parent).filter((d) => d !== dragged);
  // After the row above's own ancestor at this depth (the row above, or the deck it's inside),
  // or first when the row above is the new parent itself.
  const before = after !== null && depthOf(after) >= depth ? deckLineage(after)[depth] : null;
  const at = before === null ? 0 : siblings.indexOf(before) + 1;
  const order = [...siblings.slice(0, at), to, ...siblings.slice(at)];
  if (to === dragged && sameOrder(order, childrenOf(decks, parent))) return null;
  return { from: dragged, to, parent, order };
}

/** `deck` a place up (-1) or down (1) among its siblings, for VoiceOver's Move up and Move down. Null at either end. */
export function siblingStep(decks: string[], deck: string, by: -1 | 1): DeckMove | null {
  const parent = parentOf(deck);
  const siblings = childrenOf(decks, parent);
  const i = siblings.indexOf(deck);
  const j = i + by;
  if (i < 0 || j < 0 || j >= siblings.length) return null;
  const order = [...siblings];
  [order[i], order[j]] = [order[j], order[i]];
  return { from: deck, to: deck, parent, order };
}

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((d, i) => d === b[i]);
