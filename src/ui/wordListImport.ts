import type { AnkiLink } from '../db/ankiLink';
import type { Repo } from '../db/repo';
import { importTsv, type ImportResult } from '../import/tsv';
import { leaveAnkiNotes, reconcileIds } from '../import/reconcile';

/**
 * A text file of notes (.txt, .tsv or .csv: a word list, or Anki's "Notes in Plain Text") written into
 * Franki, as the Anki screen and a deck with no cards import one. Into `deck` when it's given (a row's
 * own deck column still wins), each note in the deck's language when Deck options set one. Returns what
 * was written, with the importer's warnings.
 */
export async function importWordList(repo: Repo & AnkiLink, text: string, fileName: string, deck?: { name: string; noteLanguage?: string; askBothWays?: boolean }): Promise<ImportResult> {
  const notes = await repo.listNotes();
  // Anki's decks with their ids, and Franki's own by name, for a deck column that gives a deck's id.
  const decks = [...await repo.ankiDecks(), ...[...new Set(notes.map((n) => n.deck))].map((name) => ({ name }))];
  // A row matching a note from Anki is left alone: this import can't change Anki's copy.
  const cards = await repo.listCards();
  const ankiNotes = new Set(cards.filter((c) => c.ankiId).map((c) => c.noteId));
  // New rows come in after every card there, in file order; a card already here keeps its place.
  const had = new Map(cards.map((c) => [c.id, c.position]));
  const firstPosition = cards.reduce((n, c) => Math.max(n, (c.position ?? -1) + 1), 0);
  const separator = fileName.toLowerCase().endsWith('.csv') ? ',' : undefined;
  // A deck set to a language: its imported words are in it, and ask both ways when it says so.
  const fieldDefaults = deck?.noteLanguage ? { Language: deck.noteLanguage, ...(deck.askBothWays ? { GenerateReverse: 'y' } : {}) } : undefined;
  const parsed = importTsv(text, { noteTypes: await repo.listNoteTypes(), decks, separator, firstPosition, fallbackDeck: deck?.name, fieldDefaults });
  const imported = leaveAnkiNotes(reconcileIds(parsed, notes, cards), ankiNotes);
  const result = { ...imported, cards: imported.cards.map((c) => (had.has(c.id) ? { ...c, position: had.get(c.id) } : c)) };
  await repo.upsertNotesAndCards(result.notes, result.cards);
  return result;
}
