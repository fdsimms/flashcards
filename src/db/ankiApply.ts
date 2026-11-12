import type { Card, Note } from '../core/types';

/**
 * What taking in Anki's collection writes to Franki's tables, worked out before writing: only the
 * notes and cards whose row would change, and the cards to retire. After a sync nearly every row
 * is the same as before, and writing all of them (one statement per row, each its own trip through
 * expo-sqlite) was most of a refresh's time (#17). Rows are compared as the exact values the
 * writes bind, so writing just the plan leaves the tables as rewriting every row would.
 */

export type SqlValue = string | number | null;

export const NOTE_COLUMNS = ['id', 'deck', 'model', 'fields', 'tags'] as const;
export const CARD_COLUMNS = [
  'id', 'note_id', 'kind', 'suspended', 'retired', 'anki_id', 'buried_at', 'deck', 'filtered_deck', 'position',
  'anki_mod', 'filtered_due', 'preview_due', 'flag', 'sched', 'state', 'due',
] as const;

const placeholders = (n: number) => Array(n).fill('?').join(', ');
export const NOTE_UPSERT_SQL = `INSERT OR REPLACE INTO notes (${NOTE_COLUMNS.join(', ')}) VALUES (${placeholders(NOTE_COLUMNS.length)})`;
export const CARD_UPSERT_SQL = `INSERT OR REPLACE INTO cards (${CARD_COLUMNS.join(', ')}) VALUES (${placeholders(CARD_COLUMNS.length)})`;
export const CARD_RETIRE_SQL = 'UPDATE cards SET retired = 1 WHERE id = ?';
export const NOTE_ROWS_SQL = `SELECT ${NOTE_COLUMNS.join(', ')} FROM notes`;
export const CARD_ROWS_SQL = `SELECT ${CARD_COLUMNS.join(', ')} FROM cards`;

/** A note as its row's values, in NOTE_COLUMNS order. */
export function noteValues(n: Note): SqlValue[] {
  return [n.id, n.deck, n.model, JSON.stringify(n.fields), JSON.stringify(n.tags)];
}

/** An Anki card as its row's values, in CARD_COLUMNS order: Anki's copy is the record, so it's never retired. */
export function cardValues(c: Card): SqlValue[] {
  return [
    c.id, c.noteId, c.kind, c.suspended ? 1 : 0, 0, c.ankiId ?? null, c.buriedAt ?? null, c.deck ?? null, c.filteredDeck ?? null,
    c.position ?? null, c.ankiMod ?? null, c.filteredDue ?? null, c.previewDue ?? null, c.flag ?? 0,
    JSON.stringify(c.sched), c.sched.state, c.sched.due,
  ];
}

/** A stored row (an object from a SELECT of `columns`) as values in that order. */
export function rowValues(row: Record<string, unknown>, columns: readonly string[]): SqlValue[] {
  return columns.map((k) => (row[k] ?? null) as SqlValue);
}

const same = (a: SqlValue[], b: SqlValue[] | undefined) => !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The writes that bring the stored rows (`existing`, as `rowValues`) to what taking in `notes`
 * and `cards` gives: every note and card row that differs, and the Anki cards no longer in the
 * collection, retired (kept with their history), as applyAnkiCollection has always done.
 */
export function ankiCollectionPlan(
  existing: { notes: SqlValue[][]; cards: SqlValue[][] },
  notes: Note[], cards: Card[],
): { notes: SqlValue[][]; cards: SqlValue[][]; retire: string[] } {
  const storedNotes = new Map(existing.notes.map((r) => [r[0] as string, r]));
  const storedCards = new Map(existing.cards.map((r) => [r[0] as string, r]));
  // The last of a repeated id wins, as the last INSERT OR REPLACE would.
  const noteRows = new Map(notes.map((n) => [n.id, noteValues(n)]));
  const cardRows = new Map(cards.map((c) => [c.id, cardValues(c)]));
  const retiredAt = CARD_COLUMNS.indexOf('retired');
  const ankiIdAt = CARD_COLUMNS.indexOf('anki_id');
  return {
    notes: [...noteRows].filter(([id, v]) => !same(v, storedNotes.get(id))).map(([, v]) => v),
    cards: [...cardRows].filter(([id, v]) => !same(v, storedCards.get(id))).map(([, v]) => v),
    retire: existing.cards.filter((r) => r[ankiIdAt] !== null && r[retiredAt] !== 1 && !cardRows.has(r[0] as string)).map((r) => r[0] as string),
  };
}
