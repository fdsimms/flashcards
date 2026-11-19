import { leadingArticle } from './gender';
import type { Segment } from './highlight';
import { htmlToText } from './html';
import type { Note } from './types';

/**
 * A card's Grammar box: what kind of word it is (`pattern`), then its forms, each under the name of
 * what it is, and what it takes. A bare form ("poniedziałku") tells a learner nothing until they
 * know which form it is, so nothing here is shown without its name.
 *
 * It reads an Omnilanguage note's KeyForms as one `label: form` per line:
 *
 *     pattern: Masculine inanimate. Genitive in -u. The e drops out.
 *     genitive: poniedziałku
 *     plural: poniedziałki
 *     takes: do + genitive (dzwonić do kogoś)
 *
 * `pattern` is the line across the top and `takes` the row across the bottom; a bracket at a line's
 * end is a quieter second line under the form. The fields that hold one form each (Plural, Genitive,
 * a counting word, Auxiliary, AspectPartner) join them as cells, and VerbClass is the pattern when no
 * line gives one. A KeyForms line with no label, as the older notes have, is shown whole under
 * "key forms" until it's rewritten. The MCP holds new notes to the labeled form (omnilanguage.py).
 * Pure: display only, never a rating or a schedule.
 */
export interface GrammarCell {
  /** What the form is: "genitive", "past", "takes". */
  label: string;
  value: string;
  /** A quieter line under the form: "zadzwonię", "dzwonić do kogoś". */
  detail?: string;
  /** The form split where it stops matching the word, for the screen to pick out what changed. */
  segments?: Segment[];
  /** Takes the box's whole width (what the word takes, an unlabeled line), not half of it. */
  wide?: boolean;
}

export interface WordGrammar {
  pattern?: string;
  cells: GrammarCell[];
}

/** A line's label: a word or three of Latin letters before ": ". */
const LABELED = /^([a-z][a-z ,/()-]{0,28}):\s+(\S.*)$/i;
const DETAIL = /^(.*\S)\s+\(([^()]+)\)$/;

export interface KeyFormLine { label: string; value: string; detail?: string }

/** KeyForms as its labeled lines, the pattern and what the word takes apart, and the lines with no label. */
export function parseKeyForms(html: string | undefined): { pattern?: string; takes?: KeyFormLine; lines: KeyFormLine[]; loose: string[] } {
  const out: { pattern?: string; takes?: KeyFormLine; lines: KeyFormLine[]; loose: string[] } = { lines: [], loose: [] };
  for (const raw of htmlToText(html ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = LABELED.exec(line);
    if (!m) { out.loose.push(line); continue; }
    // Lower case however it was typed, but "I" stays a capital: it is shown as the form's name.
    const label = m[1].trim().toLowerCase().replace(/\bi\b/g, 'I');
    if (label === 'pattern') { out.pattern = m[2].trim(); continue; }
    const d = DETAIL.exec(m[2].trim());
    const parsed: KeyFormLine = d ? { label, value: d[1], detail: d[2] } : { label, value: m[2].trim() };
    if (label === 'takes') out.takes = parsed;
    else out.lines.push(parsed);
  }
  return out;
}

/** The fewest letters a form must share with its word before the rest is called a change: "do" and "dom" share too little to mean anything. */
const MIN_SHARED = 3;

/**
 * A form split where it stops matching the word (poniedział|ku against poniedziałek), so the part
 * that changed can be picked out. Undefined when they share no real start (warf ab, zadzwonić) or
 * the form is the word.
 */
export function formSegments(form: string, word: string): Segment[] | undefined {
  const a = form.toLocaleLowerCase();
  const b = word.toLocaleLowerCase();
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i < MIN_SHARED || i >= form.length) return undefined;
  return [{ text: form.slice(0, i), marked: false }, { text: form.slice(i), marked: true }];
}

/** The fields that hold one form each, with the name the form is shown under. */
const FIELD_CELLS: [field: string, label: string][] = [
  ['Plural', 'plural'], ['Genitive', 'genitive'], ['Classifier', 'counting word'], ['Auxiliary', 'auxiliary'], ['AspectPartner', 'aspect pair'],
];

/**
 * The note's Grammar box, or undefined when it has nothing to put in one. `countedApart` is for a
 * Thai noun, whose counting word the card shows counted in its own box (cards.ts).
 */
export function wordGrammar(note: Note, countedApart = false): WordGrammar | undefined {
  const text = (name: string) => htmlToText(note.fields[name] ?? '');
  const entry = text('Entry');
  const word = (leadingArticle(entry)?.rest ?? entry).trim();
  const parsed = parseKeyForms(note.fields.KeyForms);
  const cell = (label: string, value: string, detail?: string): GrammarCell => {
    const segments = formSegments(value, word);
    return { label, value, ...(detail ? { detail } : {}), ...(segments ? { segments } : {}) };
  };
  const cells: GrammarCell[] = [];
  if (parsed.loose.length) cells.push({ label: 'key forms', value: parsed.loose.join(', '), wide: true });
  for (const l of parsed.lines) cells.push(cell(l.label, l.value, l.detail));
  for (const [field, label] of FIELD_CELLS) {
    const value = text(field);
    if (!value || cells.some((c) => c.label === label)) continue;
    if (field === 'Classifier' && countedApart) continue;
    // "perfect: hat abgeworfen" already says which auxiliary.
    if (field === 'Auxiliary' && cells.some((c) => c.label === 'perfect')) continue;
    cells.push(cell(label, value));
  }
  if (parsed.takes) cells.push({ label: 'takes', value: parsed.takes.value, ...(parsed.takes.detail ? { detail: parsed.takes.detail } : {}), wide: true });
  const pattern = parsed.pattern ?? (text('VerbClass') || undefined);
  return pattern || cells.length ? { ...(pattern ? { pattern } : {}), cells } : undefined;
}

/** The box as plain text, a line each: what a screen reader or a search reads. */
export function grammarText(g: WordGrammar): string {
  return [g.pattern, ...g.cells.map((c) => `${c.label}: ${c.value}${c.detail ? ` (${c.detail})` : ''}`)].filter(Boolean).join('\n');
}

/** The forms KeyForms lists, without their labels: what a look-alike check compares (lookalikes.ts). */
export function keyFormValues(html: string | undefined): string[] {
  const parsed = parseKeyForms(html);
  return [...parsed.lines.map((l) => l.value), ...parsed.loose.flatMap((l) => l.split(/[,;]/))].map((v) => v.trim()).filter(Boolean);
}
