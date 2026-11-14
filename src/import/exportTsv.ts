import type { Note, NoteType } from '../core/types';
import { omnilanguageFieldNames } from './models';

/** One note type's notes as an Anki "Notes in Plain Text" file. */
export interface TsvFile {
  model: string;
  /** A name safe to save under, ending in .txt. */
  name: string;
  text: string;
  notes: number;
}

/**
 * A cell as Anki's text export writes it: quoted, with quotes doubled, when it holds a tab, a line
 * break or a quote. A cell starting with "#" is quoted too, so the first column can't be read back
 * as a header line.
 */
function cell(value: string): string {
  return /[\t\r\n"]/.test(value) || value.startsWith('#') ? `"${value.replace(/"/g, '""')}"` : value;
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'notes';

/**
 * `notes` as Anki's plain text files, one per note type (a file's columns are one note type's
 * fields, and a deck usually has several). Each file has the GUID first, then the deck, the
 * fields in the note type's order, and the tags, with the header lines that say so, so Anki and
 * Franki's own importer (`importTsv`) read it back: the GUID is the note's id, so importing it
 * again updates the notes rather than adding them. Fields stay HTML, as they're stored.
 * Scheduling isn't in the file: text files don't carry it.
 *
 * The note types' field order comes from `noteTypes`, Omnilanguage's own when it isn't there;
 * fields a note has beyond that follow in the order they appear.
 */
export function exportTsv(notes: Note[], noteTypes: Map<string, NoteType>, label: string): TsvFile[] {
  const byModel = new Map<string, Note[]>();
  for (const n of notes) byModel.set(n.model, [...(byModel.get(n.model) ?? []), n]);
  const files: TsvFile[] = [];
  for (const [model, group] of byModel) {
    const known = model === 'Omnilanguage' ? omnilanguageFieldNames : noteTypes.get(model)?.fields ?? [];
    const names = [...known];
    for (const n of group) for (const k of Object.keys(n.fields)) if (!names.includes(k)) names.push(k);
    const lastColumn = names.length + 3;
    const lines = [
      '#separator:tab',
      '#html:true',
      '#guid column:1',
      `#notetype:${model}`,
      '#deck column:2',
      `#tags column:${lastColumn}`,
      `#columns:${['GUID', 'Deck', ...names, 'Tags'].map(cell).join('\t')}`,
      ...group.map((n) => [n.id, n.deck, ...names.map((k) => n.fields[k] ?? ''), n.tags.join(' ')].map(cell).join('\t')),
    ];
    files.push({
      model,
      name: `${fileSafe(label)}${byModel.size > 1 ? ` - ${fileSafe(model)}` : ''}.txt`,
      text: `${lines.join('\n')}\n`,
      notes: group.length,
    });
  }
  return files;
}
