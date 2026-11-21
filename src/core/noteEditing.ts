import { nextStudyDayStart } from './day';
import { htmlToText } from './html';
import { isBuried } from './queue';
import { isLeechNote } from './trouble';
import { searchPlace, searchQuery, searchRank, type SearchPlace } from './searchRank';
import type { Card, Note } from './types';

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

/**
 * A stored field as the editor would store it back untouched (`<br/>` and a raw new line both as
 * `<br>`): what an edit is compared with, so opening a note doesn't count as changing it.
 */
export function asEdited(html: string): string {
  return editTextToField(fieldToEditText(html));
}

/** Tags typed as text, separated by spaces: each once, whatever its case (the first spelling wins). */
/**
 * The note type a new note in `deck` starts as: the one its notes (subdecks included) use most, else
 * the collection's most used, else the first of `typeNames`. The note editor and Quick add both start
 * here, so a word added either way is the same kind of note.
 */
export function startModelFor(notes: readonly Note[], typeNames: readonly string[], deck: string): string {
  const inDeck = notes.filter((n) => n.deck === deck || n.deck.startsWith(`${deck}::`));
  const counts = new Map<string, number>();
  for (const n of inDeck.length ? inDeck : notes) counts.set(n.model, (counts.get(n.model) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? typeNames[0] ?? '';
}

export function parseTags(text: string): string[] {
  const seen = new Map<string, string>();
  for (const t of text.split(/\s+/)) if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()];
}

/**
 * Whether a note being added differs from how its editor opened: blank fields don't count, and a
 * note opened already filled in (Read & Listen's queued words, a cram's tag) isn't changed until
 * something in it is.
 */
export function addDraftChanged(start: { fields: Record<string, string>; tags: string }, now: { fields: Record<string, string>; tags: string }): boolean {
  const filled = (fields: Record<string, string>) => JSON.stringify(Object.entries(fields).filter(([, v]) => v.trim()).sort(([a], [b]) => a.localeCompare(b)));
  return filled(start.fields) !== filled(now.fields) || parseTags(start.tags).join(' ') !== parseTags(now.tags).join(' ');
}

/** The names of the fields a note shows first: Omnilanguage's Entry and Meaning, else the first two. */
function previewFieldNames(note: Note): [string | undefined, string | undefined] {
  if ('Entry' in note.fields && 'Meaning' in note.fields) return ['Entry', 'Meaning'];
  const names = Object.keys(note.fields);
  return [names[0], names[1]];
}

/** The fields a note shows first, as plain text: Omnilanguage's Entry and Meaning, else the first two. */
export function notePreview(note: Note): { front: string; back: string } {
  const line = (html: string | undefined) => htmlToText(html ?? '').replace(/\s+/g, ' ').trim();
  const [front, back] = previewFieldNames(note);
  return { front: line(front && note.fields[front]), back: line(back && note.fields[back]) };
}

const fold = (s: string) => s.toLocaleLowerCase();

/**
 * A note as search reads it: what shows first, what shows second, every other field, then its
 * tags and deck. Worked out once per note object and kept while it lives, so typing doesn't redo
 * it for every note at each letter; a note is never changed in place (an edit loads new ones).
 */
const searchPlaces = new WeakMap<Note, SearchPlace[]>();

function searchPlacesOf(note: Note): SearchPlace[] {
  let places = searchPlaces.get(note);
  if (!places) {
    const [front, back] = previewFieldNames(note);
    const field = (name: string | undefined) => htmlToText((name && note.fields[name]) ?? '');
    const others = Object.keys(note.fields).filter((k) => k !== front && k !== back).map(field).join('\n');
    places = [field(front), field(back), others, [...note.tags, note.deck].join('\n')].map(searchPlace);
    searchPlaces.set(note, places);
  }
  return places;
}

/**
 * Notes matching every word of a search, case and accents aside, in any field (as text), a tag or
 * the deck's name; within a deck and its subdecks when one is given. With a search, the closest
 * matches come first (`searchRank`): the search on the front before it in the meaning, before it
 * in another field, before a tag or the deck; and within each, the search as a whole entry
 * ("performance" in "performance; show") before a whole word, the start of a word, then anywhere.
 * Ties, and every note when nothing is typed, are sorted by what they show first, as Anki's
 * browser sorts by the sort field.
 */
export function searchNotes(notes: Note[], query: string, deck?: string | null): Note[] {
  const search = searchQuery(query);
  const inDeck = (d: string) => !deck || d === deck || d.startsWith(`${deck}::`);
  const rank = new Map<string, number>();
  const out = notes.filter((n) => {
    if (!inDeck(n.deck)) return false;
    if (!search.words.length) return true;
    const r = searchRank(searchPlacesOf(n), search);
    if (r === undefined) return false;
    rank.set(n.id, r);
    return true;
  });
  const key = new Map(out.map((n) => [n.id, notePreview(n).front]));
  return out.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || key.get(a.id)!.localeCompare(key.get(b.id)!));
}

/** What Browse can narrow its notes to, beside a deck and a search. */
export type NoteFilter = 'new' | 'due' | 'leech' | 'suspended' | 'flagged';

export const NOTE_FILTERS: { value: NoteFilter; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'due', label: 'Due today' },
  { value: 'leech', label: 'Leeches' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'flagged', label: 'Flagged' },
];

/**
 * Whether a note belongs under a Browse filter. Browse lists notes, so a filter about cards keeps
 * a note with at least one card in that state; a retired card (a kind the note no longer makes)
 * counts for none. New and Due today are cards that can be studied, so not suspended, and Due
 * today, as Anki's `is:due`, leaves out a card buried today: a review or step due before the next
 * study day starts. Leeches go by the note's `leech` tag; Flagged is any of Anki's flags.
 */
export function matchesNoteFilter(filter: NoteFilter, note: Note, cards: Card[], now: Date, dayStartsAtHour: number): boolean {
  if (filter === 'leech') return isLeechNote(note);
  const live = cards.filter((c) => !c.retired);
  if (filter === 'suspended') return live.some((c) => c.suspended);
  if (filter === 'flagged') return live.some((c) => !!c.flag);
  const studyable = live.filter((c) => !c.suspended);
  if (filter === 'new') return studyable.some((c) => c.sched.state === 0);
  const end = nextStudyDayStart(now, dayStartsAtHour).getTime();
  return studyable.some((c) => c.sched.state !== 0 && !isBuried(c, now, dayStartsAtHour) && new Date(c.sched.due).getTime() < end);
}

/**
 * The notes still in the collection: a note whose cards were all in Anki and are all retired was
 * deleted there (applyAnkiCollection retires an Anki card that's gone, keeping its history), so
 * Browse and the editor's duplicate check leave it out. Editing it could only be refused.
 */
export function notesStillThere(notes: Note[], cards: Card[]): Note[] {
  const live = new Set<string>();
  const fromAnki = new Set<string>();
  for (const c of cards) {
    if (!c.retired) live.add(c.noteId);
    if (c.ankiId) fromAnki.add(c.noteId);
  }
  return notes.filter((n) => live.has(n.id) || !fromAnki.has(n.id));
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
 * compares them (as text, case aside). The editor warns as you type; `saveNote` refuses.
 */
export function duplicateOf(notes: Note[], draft: { id?: string; model: string; fields: Record<string, string> }, firstField: string): Note | undefined {
  const mine = duplicateKey(draft.fields[firstField]);
  if (!mine) return undefined;
  return notes.find((n) => n.id !== draft.id && n.model === draft.model && duplicateKey(n.fields[firstField]) === mine);
}

/**
 * What `duplicateOf` compares a first field by: its text, case aside. Exported for a check that indexes
 * many notes at once (Quick add's), so it can't drift from the refusal it predicts.
 */
export function duplicateKey(html: string | undefined): string {
  return fold(htmlToText(html ?? '').trim());
}
