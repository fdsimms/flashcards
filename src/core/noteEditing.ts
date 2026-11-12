import { htmlToText } from './html';
import type { Note } from './types';

/**
 * The pure half of adding, editing and finding notes: what the editor shows for a field, what it
 * stores back, tags typed as text, a note's preview line, search, and the duplicate warning.
 */

/**
 * A field as the editor shows it: Anki stores HTML, and a line break there is `<br>`, so those
 * become new lines. Any other HTML is shown and kept as it is, so saving never changes formatting
 * the editor doesn't understand.
 */
export function fieldToEditText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n');
}

/** What the editor stores back: new lines as `<br>`, as Anki's editor writes them. */
export function editTextToField(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n/g, '<br>');
}

/** Tags typed as text, separated by spaces: each once, whatever its case (the first spelling wins). */
export function parseTags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const t of text.split(/\s+/)) if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()];
}

/** The fields a note shows first, as plain text: Omnilanguage's Entry and Meaning, else the first two. */
export function notePreview(note: Note): { front: string; back: string } {
  const line = (html: string | undefined) => htmlToText(html ?? '').replace(/\s+/g, ' ').trim();
  if ('Entry' in note.fields && 'Meaning' in note.fields) return { front: line(note.fields.Entry), back: line(note.fields.Meaning) };
  const values = Object.values(note.fields);
  return { front: line(values[0]), back: line(values[1]) };
}

const fold = (s: string) => s.toLocaleLowerCase();

/**
 * Notes matching every word of a search, case aside, in any field (as text), a tag or the deck's
 * name; within a deck and its subdecks when one is given. Sorted by what they show first, as
 * Anki's browser sorts by the sort field.
 */
export function searchNotes(notes: Note[], query: string, deck?: string | null): Note[] {
  const words = query.trim().split(/\s+/).filter(Boolean).map(fold);
  const inDeck = (d: string) => !deck || d === deck || d.startsWith(`${deck}::`);
  const out = notes.filter((n) => {
    if (!inDeck(n.deck)) return false;
    if (!words.length) return true;
    const hay = fold([...Object.values(n.fields).map(htmlToText), ...n.tags, n.deck].join('\n'));
    return words.every((w) => hay.includes(w));
  });
  const key = new Map(out.map((n) => [n.id, notePreview(n).front]));
  return out.sort((a, b) => key.get(a.id)!.localeCompare(key.get(b.id)!));
}

export type DeckChip = { label: string; deck: string | null; selected: boolean };

/**
 * The deck chips Browse shows: one row per level of the picked deck, each with an "All" chip for
 * the level above (null for every deck) and the decks that have notes at that level. A row for
 * the top level needs more than one deck to be worth showing; a row of subdecks shows as soon as
 * the picked deck has one.
 */
export function deckChipRows(notes: Note[], scope: string | null): DeckChip[][] {
  const picked = scope ? scope.split('::') : [];
  const rows: DeckChip[][] = [];
  for (let level = 0; level <= picked.length; level++) {
    const parent = level === 0 ? null : picked.slice(0, level).join('::');
    const names = new Set<string>();
    for (const n of notes) {
      const parts = n.deck.split('::');
      if (parts.length <= level) continue;
      if (parent && parts.slice(0, level).join('::') !== parent) continue;
      names.add(parts[level]);
    }
    if (level === 0 ? names.size < 2 : names.size < 1) break;
    const all: DeckChip = { label: parent ? `All ${picked[level - 1]}` : 'All decks', deck: parent, selected: scope === parent };
    const chips = [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
      const deck = parent ? `${parent}::${name}` : name;
      return { label: name, deck, selected: scope === deck };
    });
    rows.push([all, ...chips]);
    if (!names.has(picked[level] ?? '')) break;
  }
  return rows;
}

/**
 * Another note of the same type whose first field reads the same, as Anki's duplicate check
 * compares them (as text, case aside). The editor warns; it doesn't refuse.
 */
export function duplicateOf(notes: Note[], draft: { id?: string; model: string; fields: Record<string, string> }, firstField: string): Note | undefined {
  const text = (html: string | undefined) => fold(htmlToText(html ?? '').trim());
  const mine = text(draft.fields[firstField]);
  if (!mine) return undefined;
  return notes.find((n) => n.id !== draft.id && n.model === draft.model && text(n.fields[firstField]) === mine);
}
