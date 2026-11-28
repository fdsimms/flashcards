import type { Note } from '../core/types';
import type { RowGiven } from '../import/tsv';
import { ankiDeckIdOrCreate } from './deckEdits';
import { insertAnkiNote, updateAnkiNote, type AnkiNoteType } from './noteWrites';
import type { SyncDb } from './sync/collectionSync';
import { cleanField, fieldChecksum, stripHtmlPreservingMediaFilenames } from './sync/noteFields';

/**
 * A text file's notes (a word list, or Anki's "Notes in Plain Text") written into the kept
 * collection as Anki's own CSV import writes them (rslib's import_export/text/import.rs, with its
 * defaults: existing notes updated, matched within the note type). A row is matched by its GUID
 * when it has one, else by its first field with the HTML taken off; a match of the same note type
 * is updated (the fields the row gives, its tags when the file has a tags column, the file's #tags
 * added, its deck and scheduling kept), and a row with none is added to its deck, made if the
 * collection doesn't have it. Notes the import itself adds are never matched, as Anki matches only
 * what the collection had before. Everything runs in one transaction, so a failure adds nothing.
 */

export interface TextImportRow {
  /** The note as the file gave it (`importTsv`): its deck, note type, fields and tags. */
  note: Note;
  given: RowGiven;
  noteType: AnkiNoteType;
}

export interface TextImportResult {
  added: number;
  updated: number;
  /** Matched notes the row would leave exactly as they are. */
  unchanged: number;
  warnings: string[];
}

const NOTE_FIELDS_SEP = '\x1f';

const strip = (field: string) => stripHtmlPreservingMediaFilenames(field.normalize('NFC'));

/**
 * Writes `rows` into the collection. `ordsFor` is the card templates (ordinals) a note with these
 * fields generates, as Franki works them out (`cardsFor`), so an update adds a card its new fields
 * call for, as Anki's does.
 */
export async function importTextRows(
  db: SyncDb, rows: TextImportRow[], ordsFor: (note: Note) => number[], now: Date,
): Promise<TextImportResult> {
  const out: TextImportResult = { added: 0, updated: 0, unchanged: 0, warnings: [] };
  await db.transaction(async () => {
    // What the collection had before: a note added by an earlier row is past this.
    const before = (await db.first<{ m: number | null }>('SELECT MAX(id) AS m FROM notes'))?.m ?? 0;
    for (const { note, given, noteType } of rows) {
      const label = strip(note.fields[noteType.fieldNames[0]] ?? '') || note.id;
      const dupes = await duplicatesOf(db, note, given, noteType, before);
      if (!dupes.length) {
        const ords = ordsFor(note);
        if (!ords.length) continue;
        const deckId = await ankiDeckIdOrCreate(db, note.deck, now);
        await insertAnkiNote(db, { noteType, deckId, fields: note.fields, tags: note.tags, ords, now, guid: given.guid });
        out.added++;
        continue;
      }
      for (const dupe of dupes) {
        if (Number(dupe.mid) !== Number(noteType.id)) {
          out.warnings.push(`"${label}" has the GUID of a note of another note type in Anki, so it was left as it is.`);
          continue;
        }
        const current = dupe.flds.split(NOTE_FIELDS_SEP);
        const currentTags = dupe.tags.trim().split(/\s+/).filter(Boolean);
        // As Anki's `equal_fields_and_tags`: a row whose fields, and its own tags when it has any,
        // are the note's already changes nothing, the file's #tags included.
        const identical = noteType.fieldNames.every((name, i) => !given.fields.includes(name) || cleanField((note.fields[name] ?? '').normalize('NFC')) === (current[i] ?? ''))
          && (given.rowTags === undefined || given.rowTags.join(' ') === currentTags.join(' '));
        const fields: Record<string, string> = {};
        noteType.fieldNames.forEach((name, i) => { fields[name] = !identical && given.fields.includes(name) ? note.fields[name] ?? '' : current[i] ?? ''; });
        const tags = identical ? currentTags : [...(given.rowTags ?? currentTags), ...given.fileTags];
        const merged: Note = { ...note, id: String(dupe.id), fields, tags };
        // Anki adds a card a matched note now generates even when the row changed nothing.
        await updateAnkiNote(db, { nid: Number(dupe.id), noteType, fields, tags, ords: ordsFor(merged), now });
        if (identical) out.unchanged++;
        else out.updated++;
      }
    }
  });
  return out;
}

interface Dupe { id: number; mid: number; flds: string; tags: string }

/** The notes Anki's import would take a row for (`find_duplicates`): by GUID, else by first field within the note type. */
async function duplicatesOf(db: SyncDb, note: Note, given: RowGiven, noteType: AnkiNoteType, before: number): Promise<Dupe[]> {
  if (given.guid) {
    const row = await db.first<Dupe>('SELECT id, mid, flds, tags FROM notes WHERE guid = ? AND id <= ?', given.guid, before);
    return row ? [row] : [];
  }
  const first = noteType.fieldNames[0];
  if (!first || !given.fields.includes(first)) return [];
  return notesWithFirstField(db, noteType, note.fields[first] ?? '', before);
}

/**
 * The collection's notes of `noteType` whose first field, with the HTML taken off, is `value`'s: what
 * Anki's import and duplicate check match on (the `csum` column, then the stripped text). Only notes
 * with an id up to `before`, when it's given.
 */
export async function notesWithFirstField(db: SyncDb, noteType: AnkiNoteType, value: string, before: number = Number.MAX_SAFE_INTEGER): Promise<Dupe[]> {
  const stripped = strip(value);
  const rows = await db.all<Dupe>('SELECT id, mid, flds, tags FROM notes WHERE mid = ? AND csum = ? AND id <= ?', noteType.id, fieldChecksum(stripped), before);
  return rows.filter((r) => strip(r.flds.split(NOTE_FIELDS_SEP)[0] ?? '') === stripped);
}
