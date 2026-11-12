import { isOmnilanguage, makeCards } from '../core/cards';
import { dayKeyOf } from '../core/day';
import { newSchedState, paramsForDeck } from '../core/scheduler';
import type { Card, CardKind, CollectionSettings, DeckParams, DayLimit, Note, NoteType, SchedState } from '../core/types';
import { omnilanguageKindByOrd } from './models';
import type { ImportResult } from './tsv';

/**
 * Shapes follow AnkiConnect's `notesInfo` / `cardsInfo` (which AnkiMCP mirrors).
 * Everything beyond the basics is optional so partial exports still import.
 */
export interface AnkiNoteInfo {
  noteId: number | string;
  modelName: string;
  tags?: string[];
  fields: Record<string, { value: string; order?: number } | string>;
}

export interface AnkiCardInfo {
  cardId: number | string;
  note: number | string;
  deckName: string;
  /** Template ordinal (0 = first card type, 1 = second...). */
  ord?: number;
  templateName?: string;
  /** Anki card type: 0 new, 1 learning, 2 review, 3 relearning. */
  type?: number;
  queue?: number;
  /** When Anki buried the card (unix seconds), when it's buried; `queue` then holds its ordinary queue. */
  buriedAt?: number;
  /** A new card's position in the new-card order (its `due` while new). */
  position?: number;
  /** Learning steps left (Anki's `left % 1000`), for a learning or relearning card. */
  stepsLeft?: number;
  /** The filtered deck the card is in, if any; `deckName` stays its home deck. */
  filteredDeckName?: string;
  /** Its `due` in the filtered deck (its place there). */
  filteredDue?: number;
  /** In a preview filtered deck (queue 4): when it's shown again, unix seconds. */
  previewDue?: number;
  /** When Anki last changed the card (unix seconds). */
  mod?: number;
  /**
   * Raw due value. A day number counted from `collectionCreated` for review and interday
   * learning cards; a unix timestamp in seconds for intraday learning cards (queue 1). For a new
   * card it's a position, and is ignored.
   */
  due?: number;
  /** When the card was last answered (unix seconds), e.g. from the card's FSRS data or revlog. */
  lastReview?: number;
  interval?: number;
  /** Ease factor in permille, e.g. 2500. */
  factor?: number;
  reps?: number;
  lapses?: number;
  /** FSRS memory state if available (e.g. from AnkiMCP get_card_memory_state). */
  memoryState?: { stability: number; difficulty: number };
}

/** One deck preset as AnkiMCP's `get_fsrs_params` returns it. */
export interface AnkiFsrsPreset {
  preset_name?: string;
  fsrs_weights?: number[];
  desired_retention?: number;
  max_interval?: number;
  /** Full deck names using this preset. */
  decks?: string[];
}

/** One deck's settings as read from an Anki collection (src/anki/collection.ts): its preset, with the deck's own overrides applied. */
export interface AnkiDeckConfig {
  newPerDay?: number;
  reviewsPerDay?: number;
  desiredRetention?: number;
  /** FSRS weights; empty or missing when the preset was never optimized. */
  weights?: number[];
  maxInterval?: number;
  /** The preset's Burying options. */
  buryNew?: boolean;
  buryReviews?: boolean;
  buryInterdayLearning?: boolean;
  /** Learning and relearning steps, in minutes. */
  learnSteps?: number[];
  relearnSteps?: number[];
  /** Anki's LeechAction: 0 suspend, 1 tag only. */
  leechAction?: number;
  leechThreshold?: number;
  /** The preset's display order (Anki's enum values, see `StudyOrder`). */
  newMix?: number;
  interdayLearningMix?: number;
  newSortOrder?: number;
  reviewOrder?: number;
  newGatherPriority?: number;
  /** The preset's id, and its easy days (Monday to Sunday). */
  presetId?: number;
  easyDays?: number[];
  /** Today-only limits: the limit, and the Anki day number it's for. */
  newLimitToday?: { limit: number; today: number };
  reviewLimitToday?: { limit: number; today: number };
  /** Set for a filtered deck, which has no preset of its own. */
  filtered?: { reschedule: boolean; previewSecs?: { again: number; hard: number; good: number } };
}

export interface AnkiExport {
  notes: AnkiNoteInfo[];
  cards: AnkiCardInfo[];
  /** Collection creation time (unix seconds). Needed to turn Anki's day-offset `due` into a date. */
  collectionCreated?: number;
  /** AnkiMCP `get_fsrs_params` output, as is. Gives each deck its preset's weights and retention. */
  fsrsParams?: { presets?: AnkiFsrsPreset[] };
  /** Each deck's settings, by full deck name (src/anki/collection.ts). Wins over `fsrsParams`. */
  deckConfigs?: Record<string, AnkiDeckConfig>;
  /** The collection's own scheduling settings (src/anki/collection.ts). */
  collectionSettings?: CollectionSettings;
  /** Note types' templates, fields and CSS (src/anki/collection.ts), so cards render as in Anki. */
  noteTypes?: NoteType[];
}

/** Each deck's settings from the exporter's `deckConfigs`. */
export function deckParamsFromConfigs(configs: Record<string, AnkiDeckConfig>, collectionCreated?: number): Map<string, DeckParams> {
  const out = new Map<string, DeckParams>();
  // An Anki day number counts days from the collection's creation, which Anki stamps at the start of a study day.
  const dayLimit = (l?: { limit: number; today: number }): DayLimit | undefined =>
    l && collectionCreated !== undefined ? { limit: l.limit, day: dayKeyOf(new Date((collectionCreated + l.today * 86400 + 43200) * 1000)) } : undefined;
  for (const [deck, c] of Object.entries(configs)) {
    if (c.filtered) {
      out.set(deck, { weights: [], desiredRetention: 0.9, maxInterval: 36500, filtered: c.filtered });
      continue;
    }
    out.set(deck, {
      weights: c.weights ?? [],
      desiredRetention: c.desiredRetention ?? 0.9,
      maxInterval: c.maxInterval ?? 36500,
      newPerDay: c.newPerDay,
      reviewsPerDay: c.reviewsPerDay,
      bury: { new: !!c.buryNew, reviews: !!c.buryReviews, interdayLearning: !!c.buryInterdayLearning },
      learnSteps: c.learnSteps,
      relearnSteps: c.relearnSteps,
      leech: c.leechThreshold !== undefined ? { threshold: c.leechThreshold, suspend: (c.leechAction ?? 0) === 0 } : undefined,
      order: c.newMix !== undefined ? {
        newMix: c.newMix, interdayLearningMix: c.interdayLearningMix ?? 0, newSortOrder: c.newSortOrder ?? 0,
        reviewOrder: c.reviewOrder ?? 0, newGatherPriority: c.newGatherPriority ?? 0,
      } : undefined,
      presetId: c.presetId,
      easyDays: c.easyDays?.length ? c.easyDays : undefined,
      newLimitToday: dayLimit(c.newLimitToday),
      reviewLimitToday: dayLimit(c.reviewLimitToday),
    });
  }
  return out;
}

/** Each deck's FSRS settings from the presets that list it. Presets listing no deck are skipped. */
export function deckParamsFromPresets(presets: AnkiFsrsPreset[]): Map<string, DeckParams> {
  const out = new Map<string, DeckParams>();
  for (const p of presets) {
    const params: DeckParams = {
      weights: p.fsrs_weights ?? [],
      desiredRetention: p.desired_retention ?? 0.9,
      maxInterval: p.max_interval ?? 36500,
    };
    for (const deck of p.decks ?? []) out.set(deck, params);
  }
  return out;
}

export function easeToDifficulty(factor: number | undefined): number {
  if (!factor || factor <= 0) return 5;
  return Math.min(10, Math.max(1, 5 + (2500 - factor) / 300));
}

/** Anki writes an intraday learning card's due as a unix timestamp, every other due as a day number. */
const TIMESTAMP_DUE = 1_000_000_000;

/**
 * When an Anki card is due. A day number counts days from the collection's creation, which Anki
 * stamps at the rollover hour, so the result lands on the start of that study day. Without the
 * creation time a day number can't be placed, and the card is due now (the importer warns).
 */
export function ankiDueDate(c: AnkiCardInfo, collectionCreated: number | undefined, now: Date): Date {
  if (c.due === undefined) return now;
  if (c.due >= TIMESTAMP_DUE) return new Date(c.due * 1000);
  if (collectionCreated === undefined) return now;
  return new Date((collectionCreated + c.due * 86400) * 1000);
}

/** Convert Anki's scheduling fields into an FSRS state. Prefers a real FSRS memory state when given. */
export function schedFromAnki(c: AnkiCardInfo, collectionCreated: number | undefined, now: Date): SchedState {
  const type = c.type ?? 0;
  if (type === 0) return newSchedState(now);

  // A learning card's interval is 0, or negative seconds in AnkiConnect; neither is a day count.
  const interval = Math.max(1, c.interval ?? 1);
  const due = ankiDueDate(c, collectionCreated, now);
  const stability = c.memoryState?.stability ?? interval;
  const difficulty = c.memoryState?.difficulty ?? easeToDifficulty(c.factor);
  // The real last answer when the export has it; otherwise estimated as one interval before due.
  const lastReview = c.lastReview ? new Date(c.lastReview * 1000) : new Date(due.getTime() - interval * 86400000);
  return {
    due: due.toISOString(),
    stability,
    difficulty,
    elapsedDays: 0,
    scheduledDays: type === 2 ? interval : 0,
    learningSteps: 0,
    reps: c.reps ?? 1,
    lapses: c.lapses ?? 0,
    state: type === 3 ? 3 : type === 1 ? 1 : 2,
    lastReview: lastReview.toISOString(),
  };
}

export function importAnkiJson(data: AnkiExport, opts: { now?: Date } = {}): ImportResult {
  const now = opts.now ?? new Date();
  const deckParams = data.deckConfigs
    ? deckParamsFromConfigs(data.deckConfigs, data.collectionCreated)
    : data.fsrsParams?.presets ? deckParamsFromPresets(data.fsrsParams.presets) : undefined;
  const warnings: string[] = [];
  const notes = new Map<string, Note>();
  const cardsByNote = new Map<string, AnkiCardInfo[]>();
  for (const c of data.cards ?? []) {
    const k = String(c.note);
    (cardsByNote.get(k) ?? cardsByNote.set(k, []).get(k)!).push(c);
  }

  const cards: Card[] = [];
  const skippedByModel = new Map<string, number>();
  const noteTypes = new Map((data.noteTypes ?? []).map((t) => [t.name, t]));
  for (const n of data.notes) {
    const id = String(n.noteId);
    const fields: Record<string, string> = {};
    for (const [name, v] of Object.entries(n.fields)) fields[name] = typeof v === 'string' ? v : v.value;
    const ankiCards = cardsByNote.get(id) ?? [];
    // A note's deck is its first card's (lowest template ordinal); a card elsewhere keeps its own (`Card.deck`).
    const deck = [...ankiCards].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0))[0]?.deckName ?? 'Imported';
    const note: Note = { id, deck, model: n.modelName, fields, tags: n.tags ?? [] };
    notes.set(id, note);

    // Generate our cards from the note, then overlay Anki scheduling by template ordinal. The
    // ordinal is the template's position in Anki, fixed regardless of which cards a note
    // generates. A note type with its templates known gets exactly the cards Anki has; without
    // them, only the one front/back card, from ordinal 0.
    const noteType = isOmnilanguage(note) ? undefined : noteTypes.get(note.model);
    const ankiOrds = ankiCards.length ? [...new Set(ankiCards.map((c) => c.ord ?? 0))].sort((a, b) => a - b) : undefined;
    const generated = makeCards(note, now, noteType, ankiOrds);
    const kindFor = (ord: number): CardKind | undefined =>
      isOmnilanguage(note) ? omnilanguageKindByOrd[ord] : noteType ? `t${ord}` : ord === 0 ? 'forward' : undefined;
    const byKind = new Map(generated.map((g) => [g.kind, g]));
    for (const ac of ankiCards) {
      const kind = kindFor(ac.ord ?? 0);
      const target = kind ? byKind.get(kind) : undefined;
      if (!target) {
        skippedByModel.set(n.modelName, (skippedByModel.get(n.modelName) ?? 0) + 1);
        continue;
      }
      target.sched = schedFromAnki(ac, data.collectionCreated, now);
      if (ac.stepsLeft !== undefined) {
        // ts-fsrs counts the step a learning card is on from the first (0); Anki counts the steps
        // left, the current one included. Without the preset's steps, ts-fsrs's own (1m 10m, 10m).
        const p = deckParams ? paramsForDeck(ac.deckName, deckParams) : undefined;
        const steps = (target.sched.state === 3 ? p?.relearnSteps ?? [10] : p?.learnSteps ?? [1, 10]).length;
        target.sched = { ...target.sched, learningSteps: Math.max(0, Math.min(steps - 1, steps - ac.stepsLeft)) };
      }
      target.suspended = ac.queue === -1;
      if (ac.deckName !== deck) target.deck = ac.deckName;
      if (ac.filteredDeckName) target.filteredDeck = ac.filteredDeckName;
      if (ac.filteredDue !== undefined) target.filteredDue = ac.filteredDue;
      if (ac.previewDue !== undefined) target.previewDue = new Date(ac.previewDue * 1000).toISOString();
      if (ac.mod !== undefined) target.ankiMod = ac.mod;
      // A new card's `due` is its position in the new-card order.
      const position = ac.position ?? ((ac.type ?? 0) === 0 ? ac.due : undefined);
      if (position !== undefined) target.position = position;
      target.buriedAt = ac.buriedAt !== undefined ? new Date(ac.buriedAt * 1000).toISOString() : undefined;
      target.ankiId = String(ac.cardId);
    }
    cards.push(...generated);
  }
  // One line per note type rather than one per card: a multi-template type skips thousands.
  for (const [model, count] of skippedByModel) {
    warnings.push(`${count} ${count === 1 ? 'card' : 'cards'} of note type "${model}" were skipped: its card templates weren't in the file, so only its first card type can be shown. Import your whole collection from AnkiMobile to get them all.`);
  }
  if (data.collectionCreated === undefined && data.cards?.some((c) => c.type !== 0 && (c.due ?? 0) < TIMESTAMP_DUE)) {
    warnings.push('collectionCreated missing: review cards were set due now instead of their real due dates');
  }
  return { notes: [...notes.values()], cards, warnings, deckParams, noteTypes: data.noteTypes, collectionSettings: data.collectionSettings };
}
