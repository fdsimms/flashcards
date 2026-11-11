import { makeCards } from '../core/cards';
import { newSchedState } from '../core/scheduler';
import type { Card, CardKind, DeckParams, Note, SchedState } from '../core/types';
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
  /** Raw due value: day offset from collection creation for review cards. */
  due?: number;
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

export interface AnkiExport {
  notes: AnkiNoteInfo[];
  cards: AnkiCardInfo[];
  /** Collection creation time (unix seconds). Needed to turn Anki's day-offset `due` into a date. */
  collectionCreated?: number;
  /** AnkiMCP `get_fsrs_params` output, as is. Gives each deck its preset's weights and retention. */
  fsrsParams?: { presets?: AnkiFsrsPreset[] };
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

/** Convert Anki's scheduling fields into an FSRS state. Prefers a real FSRS memory state when given. */
export function schedFromAnki(c: AnkiCardInfo, collectionCreated: number | undefined, now: Date): SchedState {
  const type = c.type ?? 0;
  if (type === 0) return newSchedState(now);

  const interval = Math.max(1, c.interval ?? 1);
  let due = now;
  if (type === 2 && c.due !== undefined && collectionCreated !== undefined) {
    due = new Date((collectionCreated + c.due * 86400) * 1000);
  }
  const stability = c.memoryState?.stability ?? interval;
  const difficulty = c.memoryState?.difficulty ?? easeToDifficulty(c.factor);
  const lastReview = new Date(due.getTime() - interval * 86400000);
  return {
    due: due.toISOString(),
    stability,
    difficulty,
    elapsedDays: 0,
    scheduledDays: interval,
    learningSteps: 0,
    reps: c.reps ?? 1,
    lapses: c.lapses ?? 0,
    state: type === 3 ? 3 : type === 1 ? 1 : 2,
    lastReview: lastReview.toISOString(),
  };
}

export function importAnkiJson(data: AnkiExport, opts: { now?: Date } = {}): ImportResult {
  const now = opts.now ?? new Date();
  const warnings: string[] = [];
  const notes = new Map<string, Note>();
  const cardsByNote = new Map<string, AnkiCardInfo[]>();
  for (const c of data.cards ?? []) {
    const k = String(c.note);
    (cardsByNote.get(k) ?? cardsByNote.set(k, []).get(k)!).push(c);
  }

  const cards: Card[] = [];
  for (const n of data.notes) {
    const id = String(n.noteId);
    const fields: Record<string, string> = {};
    for (const [name, v] of Object.entries(n.fields)) fields[name] = typeof v === 'string' ? v : v.value;
    const ankiCards = cardsByNote.get(id) ?? [];
    const deck = ankiCards[0]?.deckName ?? 'Imported';
    const note: Note = { id, deck, model: n.modelName, fields, tags: n.tags ?? [] };
    notes.set(id, note);

    // Generate our cards from the note, then overlay Anki scheduling by matching template ordinal.
    const generated = makeCards(note, now);
    const kindForOrd: CardKind[] = generated.map((g) => g.kind);
    if (ankiCards.length === 0) { cards.push(...generated); continue; }

    const byKind = new Map(generated.map((g) => [g.kind, g]));
    for (const ac of ankiCards) {
      const kind = kindForOrd[ac.ord ?? 0];
      const target = kind ? byKind.get(kind) : undefined;
      if (!target) {
        warnings.push(`Note ${id}: Anki card ord ${ac.ord ?? 0} has no matching card kind, skipped`);
        continue;
      }
      target.sched = schedFromAnki(ac, data.collectionCreated, now);
      target.suspended = ac.queue === -1;
    }
    cards.push(...generated);
  }
  if (data.collectionCreated === undefined && data.cards?.some((c) => c.type === 2)) {
    warnings.push('collectionCreated missing: review cards were set due now instead of their real due dates');
  }
  const deckParams = data.fsrsParams?.presets ? deckParamsFromPresets(data.fsrsParams.presets) : undefined;
  return { notes: [...notes.values()], cards, warnings, deckParams };
}
