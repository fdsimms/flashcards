import { parseSearch } from './ankiSearch';
import { matchesAnkiRow, rowRelativeOverdueness, rowRetrievability, type AnkiSearchRow, type AnkiSearchTiming } from './ankiRowSearch';
import { cleanDeckName } from './deckNames';
import type { NoteFilter } from './noteEditing';
import { fnvHash } from './order';

/**
 * A filtered deck as Anki keeps one (proto/anki/decks.proto, Deck.Filtered) and builds it (rslib's
 * scheduler/filtered): up to two searches, each with a limit and an order, gathered in turn, and
 * whether answers in it reschedule cards. The collection side is src/anki/filteredDeckWrites.ts.
 */

/** Anki's orders, by their number in the proto (Deck.Filtered.SearchTerm.Order), with its own labels. */
export const FILTERED_ORDERS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Oldest seen first' },
  { value: 1, label: 'Random' },
  { value: 2, label: 'Increasing intervals' },
  { value: 3, label: 'Decreasing intervals' },
  { value: 4, label: 'Most lapses' },
  { value: 5, label: 'Order added' },
  { value: 6, label: 'Order due' },
  { value: 7, label: 'Latest added first' },
  { value: 8, label: 'Retrievability ascending' },
  { value: 9, label: 'Retrievability descending' },
  { value: 10, label: 'Relative overdueness' },
];

export interface FilteredTerm { search: string; limit: number; order: number }

export interface FilteredDeckConfig {
  name: string;
  terms: FilteredTerm[];
  reschedule: boolean;
  /** How long a preview (rescheduling off) waits after Again, Hard and Good, in seconds; 0 sends the card home. */
  previewAgainSecs: number;
  previewHardSecs: number;
  previewGoodSecs: number;
}

/** A new filtered deck's settings, as Anki's `new_filtered`: 100 random cards, rescheduling on, previews at 1 and 10 minutes. */
export function newFilteredDeck(search = ''): FilteredDeckConfig {
  return { name: '', terms: [{ search, limit: 100, order: 1 }], reschedule: true, previewAgainSecs: 60, previewHardSecs: 600, previewGoodSecs: 0 };
}

/** What a second search starts as, as Anki's: 20 cards in due order. */
export const SECOND_TERM: FilteredTerm = { search: '', limit: 20, order: 6 };

/** The most cards one search may gather, as Anki's deck options allow (99,999). */
export const FILTERED_LIMIT_MAX = 99_999;

/** Why a filtered deck can't be saved as it is, or undefined. */
export function filteredDeckProblem(c: FilteredDeckConfig): string | undefined {
  const name = cleanDeckName(c.name);
  if ('problem' in name) return name.problem;
  if (!c.terms.length || c.terms.length > 2) return 'A filtered deck has one or two searches.';
  for (const [i, t] of c.terms.entries()) {
    const which = c.terms.length === 2 ? (i === 0 ? 'The first search' : 'The second search') : 'The search';
    const parsed = parseSearch(t.search);
    if (!parsed.ok) return `${which} can't be read. ${parsed.error}`;
    if (!Number.isInteger(t.limit) || t.limit < 1 || t.limit > FILTERED_LIMIT_MAX) return `${which}'s limit has to be a whole number from 1 to ${FILTERED_LIMIT_MAX}.`;
    if (!FILTERED_ORDERS.some((o) => o.value === t.order)) return `${which}'s order isn't one Anki has.`;
  }
  return undefined;
}

/** What Anki adds to every search it gathers a filtered deck with (`move_cards_matching_term`). */
export const GATHER_EXCLUSIONS = '-is:suspended -is:buried -deck:filtered';

/** A term's search as Anki runs it: the search in parentheses, then the exclusions. */
export const gatherSearch = (search: string) => `${search.trim() ? `(${search}) ` : ''}${GATHER_EXCLUSIONS}`;

/** Anki's tie-break after every order: `fnvhash(c.id, c.mod)`, sorted as the signed 64-bit value. */
const tieBreak = (r: AnkiSearchRow) => BigInt.asIntN(64, fnvHash(BigInt(r.id), BigInt(r.mod)));

type Key = number | bigint | null;
/** SQLite's sort for one key: NULL before everything ascending, after everything descending. */
function cmpKey(a: Key, b: Key, desc: boolean): number {
  if (a === b) return 0;
  if (a === null) return desc ? 1 : -1;
  if (b === null) return desc ? -1 : 1;
  const c = a < b ? -1 : 1;
  return desc ? -c : c;
}

/**
 * The cards a term gathers, in its order and cut to its limit, as Anki's `order_and_limit_for_search`
 * sorts them. `rows` are the candidates (matched already); `random` stands in for SQLite's random().
 */
export function orderTerm(
  rows: AnkiSearchRow[], term: FilteredTerm, t: AnkiSearchTiming, fsrs: boolean, random: () => number = Math.random,
): AnkiSearchRow[] {
  const keys = (r: AnkiSearchRow): [Key, boolean][] => {
    switch (term.order) {
      case 0: return [[r.revlog.length ? Math.max(...r.revlog.map((x) => x.id)) : null, false]];
      case 1: return [[random(), false]];
      case 2: return [[r.ivl, false]];
      case 3: return [[r.ivl, true]];
      case 4: return [[r.lapses, true]];
      case 5: return [[r.nid, false], [r.ord, false]];
      case 6: return [[r.due > 1_000_000_000 ? r.due : (r.due - t.today) * 86_400 + t.now, false], [r.ord, false]];
      case 7: return [[r.nid, true], [r.ord, false]];
      case 8: case 9: return fsrs ? [[rowRetrievability(r, t) ?? null, term.order === 9]] : [];
      case 10: return [[rowRelativeOverdueness(r, t), false]];
      default: return [];
    }
  };
  const keyed = rows.map((r) => ({ r, k: keys(r), tie: tieBreak(r) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i++) {
      const c = cmpKey(a.k[i][0], b.k[i][0], a.k[i][1]);
      if (c) return c;
    }
    return cmpKey(a.tie, b.tie, false);
  });
  return keyed.slice(0, term.limit).map((x) => x.r);
}

/**
 * The cards a filtered deck gathers, in the order they go in: each term's search (with Anki's
 * exclusions) over the cards not taken by an earlier term, ordered and limited. Undefined when a
 * search can't be read.
 */
export function gatherFiltered(rows: AnkiSearchRow[], terms: FilteredTerm[], t: AnkiSearchTiming, fsrs: boolean, random?: () => number): AnkiSearchRow[] | undefined {
  const taken = new Set<number>();
  const out: AnkiSearchRow[] = [];
  for (const term of terms.slice(0, 2)) {
    const parsed = parseSearch(gatherSearch(term.search));
    if (!parsed.ok || !parsed.node) return undefined;
    const node = parsed.node;
    const matched = rows.filter((r) => !taken.has(r.id) && matchesAnkiRow(node, r, t));
    for (const r of orderTerm(matched, term, t, fsrs, random)) {
      taken.add(r.id);
      out.push(r);
    }
  }
  return out;
}

/** A deck name in a search, quoted when it has a space or a quote. */
export function deckTerm(deck: string): string {
  const escaped = deck.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\*/g, '\\*').replace(/_/g, '\\_');
  return /[\s"()]/.test(deck) ? `"deck:${escaped}"` : `deck:${escaped}`;
}

/** Browse's filter chips as the Anki search each stands for, so a filtered deck made from Browse gathers what it shows. */
const FILTER_SEARCH: Record<NoteFilter, string> = {
  new: 'is:new',
  due: 'is:due',
  leech: 'tag:leech',
  suspended: 'is:suspended',
  flagged: '-flag:0',
};

/** What Browse is showing, as one search: the deck chip and filter chip folded into what was typed. */
export function browseSearch(query: string, deck: string | null, filter: NoteFilter | null): string {
  const parts = [deck ? deckTerm(deck) : '', filter ? FILTER_SEARCH[filter] : '', query.trim() ? (deck || filter ? `(${query.trim()})` : query.trim()) : ''];
  return parts.filter(Boolean).join(' ');
}
