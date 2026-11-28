import { fuzzSeed, LOAD_BALANCE_DAYS } from './ankiFuzz';
import { addCalendarDays, nextStudyDayStart, studyDayKey, studyDayStart } from './day';
import { cardHomeDeck, queueInput, treeQueue, type DeckLimits } from './deckTree';
import { balancerFrom, loadDayIndex } from './loadBalance';
import { ankiToday } from './order';
import { studiable, type StudiedToday } from './queue';
import { review, paramsForDeck, type RatingValue } from './scheduler';
import type { Answer } from './stats';
import type { Card, CollectionSettings, DeckParams, DeckSettings, Note } from './types';
import type { VacationPrefs } from './vacation';

/**
 * The next days' reviews as a simulation, for Stats' "Due in the next 30 days": what is already
 * scheduled, plus what you will probably study because of it. A card reviewed on its day comes back
 * again, and the new cards each deck lets in start reviews of their own, so counting each card once
 * on its current due date drops toward nothing by the end of the window.
 *
 * It plays the days forward on copies of the cards, using the code the app studies with: each day's
 * queue is `treeQueue` (so a deck's daily limits, its parents', the order and the progress gates
 * decide what is studied and what waits), and each answer is `review` with the deck's own FSRS
 * settings and Anki's fuzz. Nothing is read from the clock and nothing is written anywhere.
 *
 * What it can't know, it takes from your history: how often you pass a review (`passRate`). The
 * answers are dealt out evenly rather than at random, so the same collection always draws the same
 * chart. Each day's queue holds a note's siblings back as the preset's burying options say, and
 * answers are placed by Anki's load balancer (with the collection's setting), counting the days
 * earlier simulated answers took. Lookalike holds are applied to today only (`held`): which words
 * will be seen together on a later day isn't known. A deck's priority boost is left out.
 */

/** The share of reviews passed when too few answers are on record to say. */
export const DEFAULT_PASS_RATE = 0.9;
/** How many past study days of answers set the pass rate. */
export const PASS_RATE_DAYS = 30;
/** Fewer reviews than this and the pass rate is the default instead. */
const MIN_REVIEWS_FOR_RATE = 30;

export interface ForecastDay {
  key: string;
  start: Date;
  /** Cards studied that day that were already scheduled: a review that came due, or one overdue and studied late. */
  scheduled: number;
  /** Cards studied that day because of what was studied before it: new cards started, and reviews that came back. */
  expected: number;
  /** New cards started that day (part of `expected`). */
  introduced: number;
}

export interface Forecast {
  /** Today and the study days after it. */
  days: ForecastDay[];
  /** New cards started over the whole window. */
  newStarted: number;
  /** Reviews due by the last day that the daily limits kept waiting. */
  waiting: number;
}

export interface ForecastInput {
  notes: Note[];
  cards: Card[];
  params: Map<string, DeckParams>;
  collection: CollectionSettings;
  /** What each deck has studied so far today (`studiedToday`). */
  studied: Map<string, StudiedToday>;
  settings: Map<string, DeckSettings>;
  vacation?: VacationPrefs;
  /** Cards today's queue holds back because a lookalike was seen (`heldCards`). Only today: later days aren't known. */
  held?: Set<string>;
  /** The decks opened as a session: each top-level deck for the whole collection, else the deck chosen. */
  roots: string[];
  /** Daily limits to try in place of the decks' own, by deck name (what Stats' what-if panel sets). */
  limits?: Map<string, Partial<DeckLimits>>;
  /** The share of reviews passed (`passRate`). */
  passRate: number;
  now: Date;
  days: number;
}

/** What the card's answers say about how often a review is passed: the last `PASS_RATE_DAYS` days of reviews, else the default. */
export function passRate(answers: Answer[], now: Date, dayStartsAtHour: number): number {
  const since = addCalendarDays(studyDayStart(now, dayStartsAtHour), -(PASS_RATE_DAYS - 1)).getTime();
  let passed = 0;
  let total = 0;
  for (const a of answers) {
    if (a.at.getTime() < since || a.wasNew || a.kind !== 'review' || a.preview) continue;
    total++;
    if (a.rating > 1) passed++;
  }
  return total < MIN_REVIEWS_FOR_RATE ? DEFAULT_PASS_RATE : passed / total;
}

/** The decks Stats studies as sessions for a scope: each top-level deck for the whole collection, else the scope. */
export function forecastRoots(scope: string | null, decks: string[]): string[] {
  if (scope !== null) return [scope];
  return [...new Set(decks.map((d) => d.split('::')[0]))].sort((a, b) => a.localeCompare(b));
}

/** The decks the what-if panel offers limits for: the top-level decks, or the scope and the decks directly under it. */
export function limitDecks(scope: string | null, decks: string[]): string[] {
  if (scope === null) return forecastRoots(null, decks);
  const prefix = `${scope}::`;
  const children = new Set<string>();
  for (const d of decks) if (d.startsWith(prefix)) children.add(`${scope}::${d.slice(prefix.length).split('::')[0]}`);
  return [scope, ...[...children].sort((a, b) => a.localeCompare(b))];
}

/** Anki's fuzz needs a seed per card; a card with no Anki id gets one from its own id, so it spreads out the same way. */
function seedFor(card: Card): bigint {
  const anki = fuzzSeed(card.ankiId, card.sched.reps);
  if (anki !== undefined) return anki;
  let h = 1469598103934665603n;
  for (let i = 0; i < card.id.length; i++) h = BigInt.asUintN(64, (h ^ BigInt(card.id.charCodeAt(i))) * 1099511628211n);
  return BigInt.asUintN(64, h + BigInt(card.sched.reps));
}

/** The whole forecast at once: what `forecastSteps` returns once it has been run to the end. */
export function forecast(input: ForecastInput): Forecast {
  const steps = forecastSteps(input);
  for (let step = steps.next(); ; step = steps.next()) if (step.done) return step.value;
}

/**
 * The forecast one study day at a time, yielding after each so a screen can hand the thread back
 * between days (a 30-day run over thousands of cards is long enough to freeze a phone if it isn't).
 * Each yield is the day just finished; the return value is the whole forecast.
 */
export function* forecastSteps(input: ForecastInput): Generator<ForecastDay, Forecast> {
  const { collection, now, days } = input;
  const h = collection.dayStartsAtHour;
  const deckOfNote = new Map(input.notes.map((n) => [n.id, n.deck]));
  const cards = input.cards.slice();
  const indexOf = new Map(cards.map((c, i) => [c.id, i]));
  const answered = new Set<string>();
  const presetOf = new Map<string, number | undefined>();
  const paramsOf = (card: Card) => paramsForDeck(cardHomeDeck(card, deckOfNote.get(card.noteId) ?? ''), input.params);
  for (const c of cards) presetOf.set(c.id, paramsOf(c)?.presetId);
  const out: ForecastDay[] = [];
  let newStarted = 0;
  // Answers are dealt out so the failures come evenly, never as a draw: the same cards give the same chart.
  let debt = 0;
  let dayStart = studyDayStart(now, h);

  for (let d = 0; d < days; d++) {
    const next = nextStudyDayStart(dayStart, h);
    // Today is studied as it stands now. A later day is studied at its last minute, when everything
    // due that day (and every step within it) has come due, so the queue holds all of it.
    const at = d === 0 ? now : new Date(next.getTime() - 60_000);
    const base = queueInput({
      notes: input.notes, cards, params: input.params, studied: d === 0 ? input.studied : new Map(),
      gateFor: (deck) => input.settings.get(deck)?.gateCap, ownLimitsFor: (deck) => input.settings.get(deck),
      collection, now: at, vacation: input.vacation, held: d === 0 ? input.held : undefined,
    });
    const tree = !input.limits?.size ? base : {
      ...base,
      limitsFor: (deck: string) => ({ ...base.limitsFor(deck), ...definedOnly(input.limits!.get(deck)) }),
      newPerDayFor: (deck: string) => input.limits!.get(deck)?.newPerDay ?? base.newPerDayFor?.(deck) ?? base.limitsFor(deck).newPerDay,
    };

    // The load balancer's view of the coming days, as the review screen takes it when a session is built: the
    // cards on each day under each preset, and the days each note's cards are on. Each answer is added as it's given.
    const anki = ankiToday(at, h, collection.collectionCreated, collection.creationOffset);
    const countsOf = new Map<number, number[]>();
    const daysOfNote = new Map<string, number[]>();
    const balancing = collection.loadBalancer !== false;
    if (balancing) {
      for (const c of cards) {
        const preset = presetOf.get(c.id);
        const at0 = preset === undefined ? undefined : loadDayIndex(c, at, h, anki);
        if (preset === undefined || at0 === undefined) continue;
        (countsOf.get(preset) ?? countsOf.set(preset, Array<number>(LOAD_BALANCE_DAYS).fill(0)).get(preset)!)[at0]++;
        (daysOfNote.get(c.noteId) ?? daysOfNote.set(c.noteId, []).get(c.noteId)!).push(at0);
      }
    }
    const day: ForecastDay = { key: studyDayKey(dayStart, h), start: dayStart, scheduled: 0, expected: 0, introduced: 0 };
    for (const root of input.roots) {
      const q = treeQueue(root, tree);
      for (const card of [...q.due, ...q.fresh]) {
        const i = indexOf.get(card.id);
        if (i === undefined) continue;
        const wasNew = card.sched.state === 0;
        if (wasNew) { newStarted++; day.introduced++; }
        if (!wasNew && !answered.has(card.id)) day.scheduled++; else day.expected++;
        answered.add(card.id);
        const params = paramsOf(card);
        const preset = presetOf.get(card.id);
        const seed = seedFor(card);
        const counts = preset === undefined ? undefined : countsOf.get(preset);
        // A card in a filtered deck has no preset there, so it's fuzzed without balancing, as the review screen does.
        const balance = !balancing || card.filteredDeck || !counts ? undefined
          : balancerFrom(counts, params?.bury?.reviews ? daysOfNote.get(card.noteId) ?? [] : undefined, { seed, easyDays: params?.easyDays, nextDayAt: next });
        let sched = card.sched;
        // The queue is built at the day's last minute, but each card is answered when it comes due
        // that day (a new card or an overdue one at the day's start), so its learning steps run
        // inside the day. Answered at the last minute, a step would land past `next` and the card
        // would be counted again, still learning, the next day.
        const dueAt = new Date(card.sched.due);
        let when = d === 0 ? at : wasNew || dueAt < dayStart ? dayStart : dueAt;
        debt += 1 - input.passRate;
        let rating: RatingValue = 3;
        if (debt >= 1) { debt -= 1; rating = 1; }
        // A step that lands later in the same study day is answered Good when it comes: one card, studied once, that day.
        for (let step = 0; step < 6; step++) {
          sched = review(sched, rating, when, params, { dayStartsAtHour: h, seed, balance }).sched;
          const due = new Date(sched.due);
          if ((sched.state !== 1 && sched.state !== 3) || due >= next) break;
          when = due > when ? due : when;
          rating = 3;
        }
        cards[i] = { ...card, sched };
        // Now a review, it weighs on the days the balancer spreads later answers over, as in Anki.
        if (balancing && preset !== undefined && sched.state === 2 && sched.scheduledDays < LOAD_BALANCE_DAYS) {
          (countsOf.get(preset) ?? countsOf.set(preset, Array<number>(LOAD_BALANCE_DAYS).fill(0)).get(preset)!)[sched.scheduledDays]++;
          (daysOfNote.get(card.noteId) ?? daysOfNote.set(card.noteId, []).get(card.noteId)!).push(sched.scheduledDays);
        }
      }
    }
    out.push(day);
    dayStart = next;
    yield day;
  }

  // Reviews due by the last day that the limits never reached.
  let waiting = 0;
  for (const c of studiable(cards)) if (c.sched.state !== 0 && new Date(c.sched.due) < dayStart) waiting++;
  return { days: out, newStarted, waiting };
}

/** An override with its unset limits left out, so spreading it never replaces a limit with undefined. */
function definedOnly(o: Partial<DeckLimits> | undefined): Partial<DeckLimits> {
  const r: Partial<DeckLimits> = {};
  if (o?.newPerDay !== undefined) r.newPerDay = o.newPerDay;
  if (o?.reviewsPerDay !== undefined) r.reviewsPerDay = o.reviewsPerDay;
  return r;
}

/** A deck's limits as they stand today, which the what-if panel starts from. */
export function currentLimits(input: Pick<ForecastInput, 'notes' | 'cards' | 'params' | 'collection' | 'studied' | 'settings' | 'vacation' | 'held' | 'now'>, deck: string): DeckLimits {
  return queueInput({
    notes: input.notes, cards: input.cards, params: input.params, studied: input.studied,
    gateFor: (d) => input.settings.get(d)?.gateCap, ownLimitsFor: (d) => input.settings.get(d),
    collection: input.collection, now: input.now, vacation: input.vacation,
  }).limitsFor(deck);
}
