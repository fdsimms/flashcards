import { makeCards } from '../core/cards';
import type { Card, DeckParams, Note, NoteType } from '../core/types';
import { omnilanguageFieldNames } from './models';

export interface ImportResult {
  notes: Note[];
  cards: Card[];
  warnings: string[];
  /** FSRS settings by deck, when the export carried them. */
  deckParams?: Map<string, DeckParams>;
  /** Note types' templates and styling, when the export carried them. */
  noteTypes?: NoteType[];
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

const SEPARATORS: Record<string, string> = { tab: '\t', comma: ',', semicolon: ';', pipe: '|', space: ' ' };

/**
 * Import an Anki "Notes in Plain Text" export (with # header lines), e.g. the Omnilanguage TSVs.
 * Fields are mapped by position using #columns, falling back to the Omnilanguage field order.
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
    if (m) headers[m[1].trim().toLowerCase()] = m[2].trim();
    bodyStart++;
  }
  const sep = SEPARATORS[headers['separator'] ?? 'tab'] ?? '\t';
  const model = headers['notetype'] ?? 'Omnilanguage';
  const defaultDeck = headers['deck'] ?? opts.fallbackDeck ?? 'Imported';
  const columns = headers['columns'] ? headers['columns'].split(sep) : undefined;
  const tagsCol = headers['tags column'] ? parseInt(headers['tags column'], 10) - 1 : -1;
  const deckCol = headers['deck column'] ? parseInt(headers['deck column'], 10) - 1 : -1;
  const guidCol = headers['guid column'] ? parseInt(headers['guid column'], 10) - 1 : -1;

  const noteType = model === 'Omnilanguage' ? undefined : opts.noteTypes?.get(model);
  const names = columns ?? (model === 'Omnilanguage' ? omnilanguageFieldNames : noteType?.fields);
  if (!names) {
    throw new Error(`The file has no #columns line, and the fields of note type "${model}" aren't known here yet. Import the Anki export made by scripts/export-anki.mjs first, or export with columns.`);
  }

  const body = lines.slice(bodyStart).join('\n');
  const rows = parseDelimited(body, sep).filter((r) => r.some((c) => c.trim() !== ''));
  const notes: Note[] = [];
  const cards: Card[] = [];
  rows.forEach((row, idx) => {
    const fields: Record<string, string> = {};
    names.forEach((name, i) => {
      // Skip the metadata columns when #columns lists them (Tags, Deck, GUID, Note Type…).
      if (i === tagsCol || i === deckCol || i === guidCol) return;
      if (/^(tags|deck|guid|note ?type)$/i.test(name)) return;
      fields[name] = row[i] ?? '';
    });
    const tags = tagsCol >= 0 && row[tagsCol] ? row[tagsCol].split(/\s+/).filter(Boolean) : [];
    const deck = deckCol >= 0 && row[deckCol] ? row[deckCol] : defaultDeck;
    const guid = guidCol >= 0 && row[guidCol] ? row[guidCol] : undefined;
    const entry = (fields.Entry ?? Object.values(fields)[0] ?? '').trim();
    if (!entry) { warnings.push(`Row ${idx + 1}: empty first field, skipped`); return; }
    const id = guid ?? `tsv:${deck}:${entry}`;
    const note: Note = { id, deck, model, fields, tags };
    notes.push(note);
    cards.push(...makeCards(note, opts.now, noteType));
  });
  return { notes, cards, warnings };
}
