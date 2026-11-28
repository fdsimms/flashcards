import type { Card, Note } from '../core/types';
import type { AnkiLink } from '../db/ankiLink';
import { leaveAnkiNotes, reconcileIds } from '../import/reconcile';
import { importTsv, type ImportResult } from '../import/tsv';
import { cardsFor, ordOf, type NoteStore } from './noteService';
import { ankiNoteType } from './noteWrites';
import { importTextRows, type TextImportRow } from './textImportWrites';

/**
 * A text file of notes (.txt, .tsv or .csv: a word list, or Anki's "Notes in Plain Text") imported,
 * as the Anki screen and a deck with no cards import one. Into `deck` when it's given (a row's own
 * deck column still wins), each note in the deck's language when Deck options set one.
 *
 * With an Anki collection, the notes go into it as Anki's own import puts them there
 * (`importTextRows`): new ones are added, so they sync to every device, and a row that matches a note
 * Anki has updates it. Two kinds of row stay in Franki only, as every row did without a collection: one
 * matching a word an earlier import left in Franki only (moving those into Anki is its own change), and
 * one whose note type Anki doesn't have. `refresh` then reads Franki's decks from the collection again
 * (`refreshFromKeptCollection`), so the notes Anki now has come in with its ids.
 */

export interface WordListResult {
  /** Notes added to the Anki collection, and the ones there it changed or left as they were. */
  added: number;
  updated: number;
  unchanged: number;
  /** Notes written into Franki only. */
  frankiOnly: number;
  warnings: string[];
}

export async function importWordList(
  store: NoteStore & Pick<AnkiLink, 'ankiDecks'>, text: string, fileName: string,
  opts: { deck?: { name: string; noteLanguage?: string; askBothWays?: boolean }; refresh: () => Promise<void> },
  now: Date = new Date(),
): Promise<WordListResult> {
  const deck = opts.deck;
  const notes = await store.listNotes();
  // Anki's decks with their ids, and Franki's own by name, for a deck column that gives a deck's id.
  const decks = [...await store.ankiDecks(), ...[...new Set(notes.map((n) => n.deck))].map((name) => ({ name }))];
  const cards = await store.listCards();
  const ankiNotes = new Set(cards.filter((c) => c.ankiId).map((c) => c.noteId));
  // New rows kept in Franki come in after every card there, in file order; a card already here keeps its place.
  const had = new Map(cards.map((c) => [c.id, c.position]));
  const firstPosition = cards.reduce((n, c) => Math.max(n, (c.position ?? -1) + 1), 0);
  const separator = fileName.toLowerCase().endsWith('.csv') ? ',' : undefined;
  // A deck set to a language: its imported words are in it, and ask both ways when it says so.
  const fieldDefaults = deck?.noteLanguage ? { Language: deck.noteLanguage, ...(deck.askBothWays ? { GenerateReverse: 'y' } : {}) } : undefined;
  const noteTypes = await store.listNoteTypes();
  const parsed = importTsv(text, { noteTypes, decks, separator, firstPosition, fallbackDeck: deck?.name, fieldDefaults, now });
  const reconciled = reconcileIds(parsed, notes, cards);

  const keepInFranki = async (result: ImportResult): Promise<number> => {
    const kept = { ...result, cards: result.cards.map((c) => (had.has(c.id) ? { ...c, position: had.get(c.id) } : c)) };
    await store.upsertNotesAndCards(kept.notes, kept.cards);
    return kept.notes.length;
  };

  if (!(await store.keptCollection())) {
    // A row matching a note from Anki is left alone: without the collection, Anki's copy can't change.
    const imported = leaveAnkiNotes(reconciled, ankiNotes);
    return { added: 0, updated: 0, unchanged: 0, frankiOnly: await keepInFranki(imported), warnings: imported.warnings };
  }

  // `reconcileIds` keeps the import's order, so row i is the same note in both.
  const frankiNotes = new Set(notes.filter((n) => !ankiNotes.has(n.id)).map((n) => n.id));
  const frankiRows: Note[] = [];
  const toAnki: { note: Note; index: number }[] = [];
  parsed.notes.forEach((note, i) => {
    if (frankiNotes.has(reconciled.notes[i].id)) frankiRows.push(reconciled.notes[i]);
    else toAnki.push({ note, index: i });
  });

  // The importer's own warnings: `reconcileIds`' are about matching in Franki, which Anki's matching replaces here.
  const warnings = [...parsed.warnings];
  if (frankiRows.length) {
    warnings.push(`${frankiRows.length === 1 ? '1 word' : `${frankiRows.length} words`} came from an earlier import that kept ${frankiRows.length === 1 ? 'it' : 'them'} in Franki only, so ${frankiRows.length === 1 ? 'it was' : 'they were'} updated there. Settings, Anki can move such words into Anki.`);
  }
  const missingTypes = new Set<string>();
  const result = await store.lockAnki(() => store.withSyncConnection(async (db) => {
    const rows: TextImportRow[] = [];
    const typeOf = new Map<string, Awaited<ReturnType<typeof ankiNoteType>>>();
    for (const { note, index } of toAnki) {
      if (!typeOf.has(note.model)) typeOf.set(note.model, await ankiNoteType(db, note.model, noteTypes.get(note.model)?.fields ?? []));
      const noteType = typeOf.get(note.model);
      if (!noteType) {
        missingTypes.add(note.model);
        frankiRows.push(reconciled.notes[index]);
        continue;
      }
      rows.push({ note, given: parsed.rows!.get(note.id)!, noteType });
    }
    const ords = (n: Note) => cardsFor(n, noteTypes, now).map((c) => ordOf(n, c.kind)).filter((o) => o >= 0);
    return importTextRows(db, rows, ords, now);
  }));
  for (const model of missingTypes) warnings.push(`The Anki collection has no note type called "${model}", so its notes were added to Franki only.`);

  const frankiIds = new Set(frankiRows.map((n) => n.id));
  const kept = leaveAnkiNotes({ notes: frankiRows, cards: reconciled.cards.filter((c: Card) => frankiIds.has(c.noteId)), warnings: [] }, ankiNotes);
  const frankiOnly = kept.notes.length ? await keepInFranki(kept) : 0;
  if (result.added || result.updated) await store.lockAnki(opts.refresh);
  return { added: result.added, updated: result.updated, unchanged: result.unchanged, frankiOnly, warnings: [...warnings, ...kept.warnings, ...result.warnings] };
}

/** The line that says what an import did: "Imported words.txt: 40 notes added to Anki, 3 updated and 2 unchanged." */
export function wordListSummary(fileName: string, r: WordListResult): string {
  const notes = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`;
  const parts: string[] = [];
  if (r.added) parts.push(`${notes(r.added)} added to Anki`);
  if (r.updated) parts.push(`${parts.length ? r.updated : notes(r.updated)} updated`);
  if (r.unchanged) parts.push(`${parts.length ? r.unchanged : notes(r.unchanged)} unchanged`);
  if (r.frankiOnly) parts.push(`${notes(r.frankiOnly)} in Franki only`);
  if (!parts.length) return `Imported ${fileName}: no notes.`;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `Imported ${fileName}: ${list}.`;
}

/** How many notes an import brought in or matched, whichever way it went. */
export const wordListCount = (r: WordListResult) => r.added + r.updated + r.unchanged + r.frankiOnly;
