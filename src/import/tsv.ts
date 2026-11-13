import { makeCards } from '../core/cards';
import type { Card, DeckParams, Note, NoteType, CollectionSettings } from '../core/types';
import { omnilanguageFieldNames } from './models';

export interface ImportResult {
  notes: Note[];
  cards: Card[];
  warnings: string[];
  /** FSRS settings by deck, when the export carried them. */
  deckParams?: Map<string, DeckParams>;
  /** Note types' templates and styling, when the export carried them. */
  noteTypes?: NoteType[];
  /** The Anki collection's own scheduling settings, when the import was a collection. */
  collectionSettings?: CollectionSettings;
}

/** Split TSV text into rows, honoring Anki-style "quoted" fields that may contain tabs/newlines. */
export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Anki's delimiters (rslib csv/metadata.rs, Delimiter), in the order it tries them. */
const SEPARATORS: Record<string, string> = { tab: '\t', pipe: '|', semicolon: ';', colon: ':', comma: ',', space: ' ' };

/**
 * A #separator: value as Anki reads it (delimiter_from_value): a name in any case, or the
 * character itself. Past the first character, anything from the first non-alphanumeric on is cut,
 * as Anki does for a header line that was exported as a record ("Tab\t\t\t").
 */
export function separatorFrom(value: string): string | undefined {
  const chars = Array.from(value);
  let trimmed = value;
  if (chars.length > 1) {
    const cut = chars.slice(1).findIndex((ch) => !/^[0-9A-Za-z]$/.test(ch));
    if (cut >= 0) trimmed = chars.slice(0, cut + 1).join('');
  }
  const normed = trimmed.toLowerCase();
  if (Object.hasOwn(SEPARATORS, normed.trim())) return SEPARATORS[normed.trim()];
  return Object.values(SEPARATORS).find((ch) => normed === ch);
}

/**
 * The separator Anki guesses for a file with no #separator line: the first of its delimiters, in
 * its order, found in the first 8 KB after the header lines; a space when none is. Checked against
 * the anki package (`get_csv_metadata`).
 */
export function guessSeparator(body: string): string {
  const sample = new TextDecoder().decode(new TextEncoder().encode(body).slice(0, 8192));
  return Object.values(SEPARATORS).find((ch) => sample.includes(ch)) ?? ' ';
}

/** Whether Anki takes a file with no #html line as HTML: it is when it holds a tag. */
export const looksLikeHtml = (body: string) => /<\/?[A-Za-z][^>]*>/.test(body);

/** A field from a file that isn't HTML (#html:false), as Anki stores it: escaped, line breaks as <br>. */
export function plainToHtml(text: string): string {
  const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
  return text.replace(/[&<>"']/g, (c) => escapes[c]).replace(/\r?\n/g, '<br>');
}

/** A 1-based "#... column:" number as a 0-based index, or -1 without one. */
function columnIndex(value: string | undefined): number {
  const n = value === undefined ? NaN : parseInt(value.trim(), 10);
  return n > 0 ? n - 1 : -1;
}

/**
 * Import an Anki "Notes in Plain Text" export (with # header lines), e.g. the Omnilanguage TSVs.
 * Fields are mapped by position onto the columns that aren't metadata (GUID, note type, deck,
 * tags), by the names in #columns when there is one, else by the note type's field order: the
 * file's #notetype, a row's own in the note type column, or Omnilanguage. A row whose note type
 * isn't known here is skipped with a warning.
 */
export function importTsv(
  text: string,
  opts: { fallbackDeck?: string; now?: Date; noteTypes?: Map<string, NoteType> } = {},
): ImportResult {
  const warnings: string[] = [];
  const headers: Record<string, string> = {};
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let bodyStart = 0;
  while (bodyStart < lines.length && lines[bodyStart].startsWith('#')) {
    const m = /^#([^:]+):(.*)$/.exec(lines[bodyStart]);
    // Untrimmed, so "#separator: " (a space) and "#separator:\t" survive.
    if (m) headers[m[1].trim().toLowerCase()] = m[2];
    bodyStart++;
  }
  const body = lines.slice(bodyStart).join('\n');
  // With no #separator (or one Anki doesn't know), it's guessed from the text, as Anki does.
  let sep = headers['separator'] !== undefined ? separatorFrom(headers['separator']) : undefined;
  if (headers['separator'] !== undefined && !sep) {
    warnings.push(`The file's separator "${headers['separator'].trim()}" isn't one Anki writes, so it was guessed from the text. In Anki, export with Tab, Comma, Semicolon, Space, Pipe or Colon.`);
  }
  sep ??= guessSeparator(body);
  // #html:false is plain text, which Anki escapes; with no #html line, Anki decides by whether the text holds a tag.
  const html = headers['html'] !== undefined ? headers['html'].trim().toLowerCase() !== 'false' : looksLikeHtml(body);
  // #tags: go on every note, besides any in the tags column.
  const fileTags = (headers['tags'] ?? '').split(/\s+/).filter(Boolean);
  const header = (key: string) => headers[key]?.trim();
  const fileModel = header('notetype') || 'Omnilanguage';
  const defaultDeck = header('deck') || opts.fallbackDeck || 'Imported';
  const columns = headers['columns'] !== undefined ? parseDelimited(headers['columns'], sep)[0] ?? [] : undefined;
  const tagsCol = columnIndex(headers['tags column']);
  const deckCol = columnIndex(headers['deck column']);
  const guidCol = columnIndex(headers['guid column']);
  const notetypeCol = columnIndex(headers['notetype column']);
  const meta = new Set([tagsCol, deckCol, guidCol, notetypeCol].filter((i) => i >= 0));

  /** A note type's field names in Anki's order, and its templates (none for Omnilanguage, which renders natively). */
  const resolve = (model: string): { names?: string[]; noteType?: NoteType } => {
    if (model === 'Omnilanguage') return { names: omnilanguageFieldNames };
    const noteType = opts.noteTypes?.get(model);
    return { names: noteType?.fields, noteType };
  };
  if (!columns && notetypeCol < 0 && !resolve(fileModel).names) {
    throw new Error(`The file has no #columns line, and the fields of note type "${fileModel}" aren't known here yet. Import your collection from AnkiMobile first, or export with columns.`);
  }

  const rows = parseDelimited(body, sep).filter((r) => r.some((c) => c.trim() !== ''));
  const notes: Note[] = [];
  const cards: Card[] = [];
  const usedIds = new Set<string>();
  /** The row that first derived each id, for the warning when a later row derives it again. */
  const firstRow = new Map<string, number>();
  rows.forEach((row, idx) => {
    const model = notetypeCol >= 0 && row[notetypeCol]?.trim() ? row[notetypeCol].trim() : fileModel;
    const { names: typeFields, noteType } = resolve(model);
    const names = columns ?? typeFields;
    if (!names) {
      warnings.push(`Row ${idx + 1}: note type "${model}" isn't in Franki yet, so the row was skipped. Import your collection from AnkiMobile first, then import this file again.`);
      return;
    }
    const fields: Record<string, string> = {};
    if (columns) {
      columns.forEach((name, i) => {
        // Skip the metadata columns when #columns lists them (Tags, Deck, GUID, Note Type…).
        if (meta.has(i) || /^(tags|deck|guid|note ?type)$/i.test(name)) return;
        fields[name] = html ? row[i] ?? '' : plainToHtml(row[i] ?? '');
      });
    } else {
      // As Anki's map_field_columns_by_index: fields fill the columns that aren't metadata, in order.
      const fieldColumns = row.map((_, i) => i).filter((i) => !meta.has(i));
      names.forEach((name, k) => { const v = row[fieldColumns[k]] ?? ''; fields[name] = html ? v : plainToHtml(v); });
    }
    const rowTags = tagsCol >= 0 && row[tagsCol] ? row[tagsCol].split(/\s+/).filter(Boolean) : [];
    const tags = [...new Set([...fileTags, ...rowTags])];
    const deck = deckCol >= 0 && row[deckCol] ? row[deckCol] : defaultDeck;
    const guid = guidCol >= 0 && row[guidCol] ? row[guidCol] : undefined;
    const entry = (fields.Entry ?? Object.values(fields)[0] ?? '').trim();
    if (!entry) { warnings.push(`Row ${idx + 1}: empty first field, skipped`); return; }
    const derived = guid ?? `tsv:${deck}:${entry}`;
    let id = derived;
    if (usedIds.has(id)) {
      // Two rows deriving one id: with no GUID column, the same first field in the same deck (a
      // homograph, like German "Bank"). Anki imports both, so keep both: the later one gets a
      // suffix counted from the top of the file, still derived, so a re-import finds it again.
      let n = 2;
      while (usedIds.has(`${derived} (${n})`)) n++;
      id = `${derived} (${n})`;
      const first = firstRow.get(derived);
      warnings.push(first === undefined
        ? `Row ${idx + 1}: "${entry}" was imported as a separate note from another row with a similar first field.`
        : `Row ${idx + 1}: ${guid ? 'has the same GUID as' : `"${entry}" is also the first field of`} row ${first + 1}, so both were imported as separate notes. Keep the rows in this order: if either moves, importing the file again can mix up their progress.`);
    } else {
      firstRow.set(derived, idx);
    }
    usedIds.add(id);
    const note: Note = { id, deck, model, fields, tags };
    notes.push(note);
    const made = makeCards(note, opts.now, noteType);
    if (!made.length) warnings.push(`Row ${idx + 1}: "${entry}" makes no cards: every card type's front would be blank. Fill in the field its front shows.`);
    cards.push(...made);
  });
  return { notes, cards, warnings };
}
