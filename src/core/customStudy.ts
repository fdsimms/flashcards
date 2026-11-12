/**
 * Custom Study, as Anki's sheet offers it (aqt/customstudy.py and rslib's scheduler/filtered):
 * two options only raise today's limits on a deck, and four put cards into a filtered deck,
 * "Custom Study Session", that is studied next. Pure: `src/anki/customStudyWrites.ts` writes it
 * into the kept collection and `customStudyService.ts` runs it.
 */

export const CUSTOM_STUDY_DECK = 'Custom Study Session';

/** The most days or cards a field accepts: Anki's own limit for these fields. */
export const CUSTOM_STUDY_MAX = 9999;

export type CramSelect = 'new' | 'due' | 'review' | 'all';

export type CustomStudy =
  | { kind: 'moreNew'; count: number }
  | { kind: 'moreReviews'; count: number }
  | { kind: 'forgotten'; days: number }
  | { kind: 'ahead'; days: number }
  | { kind: 'previewNew'; days: number }
  | { kind: 'cram'; select: CramSelect; count: number; include: string[]; exclude: string[] };

export type CustomStudyKind = CustomStudy['kind'];

/** Anki's filtered deck sort orders (proto/anki/decks.proto, FilteredSearchOrder), the ones used here. */
export const FILTERED_ORDER = { random: 1, added: 5, due: 6 } as const;

/** What goes into the filtered deck's single search term, which Anki uses when the deck is rebuilt. */
export interface FilteredPlan {
  /** The search as Anki writes it, over the deck studied and all its subdecks. */
  search: string;
  limit: number;
  order: number;
  /**
   * Whether answers reschedule the cards. Anki's Review ahead reschedules; the rest are previews:
   * the card goes back to its deck unchanged once it's passed.
   */
  reschedule: boolean;
}

export const isLimitChange = (c: CustomStudy): c is Extract<CustomStudy, { kind: 'moreNew' | 'moreReviews' }> =>
  c.kind === 'moreNew' || c.kind === 'moreReviews';

const wholeNumber = (n: number) => Number.isInteger(n) && n >= 1 && n <= CUSTOM_STUDY_MAX;

/** Why a request can't be run (in the words to show), or undefined when it can. */
export function customStudyProblem(c: CustomStudy): string | undefined {
  const amount = c.kind === 'moreNew' || c.kind === 'moreReviews' || c.kind === 'cram' ? c.count : c.days;
  if (!wholeNumber(amount)) {
    const what = c.kind === 'moreNew' || c.kind === 'moreReviews' || c.kind === 'cram' ? 'cards' : 'days';
    return `Enter a whole number of ${what} from 1 to ${CUSTOM_STUDY_MAX}.`;
  }
  return undefined;
}

/** A deck's limit after raising it by `count`: today's limit as it stands (`deckLimits`), plus the cards asked for. */
export const raisedLimit = (current: number, count: number) => current + count;

/** A name or tag inside an Anki search's quotes: `\`, `"`, `*` and `_` are escaped. */
const quoted = (s: string) => `"${s.replace(/[\\"*_]/g, (ch) => `\\${ch}`)}"`;

/** Tags typed in a field, split on spaces and commas, "#" and empties dropped. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^#/, '')).filter(Boolean))];
}

/**
 * The search a filtered deck stores for a custom study, as aqt/customstudy.py builds it. Cards
 * that are suspended, buried or already in another filtered deck are left out whatever the
 * search says, as Anki's own rebuild does.
 */
export function filteredPlan(c: CustomStudy, deck: string): FilteredPlan | undefined {
  const inDeck = `deck:${quoted(deck)}`;
  switch (c.kind) {
    case 'moreNew':
    case 'moreReviews':
      return undefined;
    case 'forgotten':
      return { search: `${inDeck} rated:${c.days}:1`, limit: CUSTOM_STUDY_MAX, order: FILTERED_ORDER.random, reschedule: false };
    case 'ahead':
      return { search: `${inDeck} prop:due<=${c.days}`, limit: CUSTOM_STUDY_MAX, order: FILTERED_ORDER.due, reschedule: true };
    case 'previewNew':
      return { search: `${inDeck} is:new added:${c.days}`, limit: CUSTOM_STUDY_MAX, order: FILTERED_ORDER.added, reschedule: false };
    case 'cram': {
      const state = { new: 'is:new', due: 'is:due', review: '-is:new', all: '' }[c.select];
      const order = c.select === 'new' ? FILTERED_ORDER.added : c.select === 'due' ? FILTERED_ORDER.due : FILTERED_ORDER.random;
      const include = c.include.length ? `(${c.include.map((t) => `tag:${quoted(t)}`).join(' or ')})` : '';
      const exclude = c.exclude.map((t) => `-tag:${quoted(t)}`).join(' ');
      return { search: [inDeck, state, include, exclude].filter(Boolean).join(' '), limit: c.count, order, reschedule: false };
    }
  }
}

export interface CustomStudyOption {
  kind: CustomStudyKind;
  title: string;
  /** What choosing it does, in a sentence. */
  detail: string;
  /** The field's label, and its starting value. */
  field: { label: string; start: number };
  /** Anki's cram choices and tag fields, for the last option. */
  cram?: boolean;
}

/** The sheet's options in Anki's order. */
export const CUSTOM_STUDY_OPTIONS: CustomStudyOption[] = [
  { kind: 'moreNew', title: "Increase today's new card limit", detail: "Study more new cards today. Tomorrow the deck's usual limit applies again.", field: { label: 'Extra new cards', start: 10 } },
  { kind: 'moreReviews', title: "Increase today's review limit", detail: "Study more reviews today. Tomorrow the deck's usual limit applies again.", field: { label: 'Extra reviews', start: 10 } },
  { kind: 'forgotten', title: "Review forgotten cards", detail: "Go over the cards you answered Again on recently. Their schedules stay as they are.", field: { label: 'Days back', start: 1 } },
  { kind: 'ahead', title: "Review ahead", detail: "Study reviews that are due in the next few days. Answers reschedule them as usual.", field: { label: 'Days ahead', start: 1 } },
  { kind: 'previewNew', title: "Preview new cards", detail: "Look at new cards added recently without starting them. Their schedules stay as they are.", field: { label: 'Added in the last days', start: 1 } },
  { kind: 'cram', title: "Study by card state or tag", detail: "Pick cards by their state or tags, for example to cram before a test. Their schedules stay as they are.", field: { label: 'Cards', start: 100 }, cram: true },
];

export const CRAM_CHOICES: { select: CramSelect; label: string }[] = [
  { select: 'new', label: 'New cards' },
  { select: 'due', label: 'Due cards' },
  { select: 'review', label: 'All review cards' },
  { select: 'all', label: 'All cards' },
];

/** The request a sheet's choices make. */
export function customStudyFrom(kind: CustomStudyKind, amount: number, cram?: { select: CramSelect; include: string; exclude: string }): CustomStudy {
  switch (kind) {
    case 'moreNew':
    case 'moreReviews':
      return { kind, count: amount };
    case 'forgotten':
    case 'ahead':
    case 'previewNew':
      return { kind, days: amount };
    case 'cram':
      return { kind, count: amount, select: cram?.select ?? 'new', include: parseTags(cram?.include ?? ''), exclude: parseTags(cram?.exclude ?? '') };
  }
}
