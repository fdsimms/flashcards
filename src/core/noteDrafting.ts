import { clozeNumbers } from './cloze';
import type { Selection, Edit } from './formatting';

/**
 * The pure half of the note editor's helpers for adding notes: a cloze around the selection, a
 * suggested tag put into the Tags field, and what the form keeps after "Save and add another".
 */

/**
 * The cloze numbers the editor's buttons offer for a note: `next` is one past the highest number
 * used in any of its fields (Anki's new-cloze key), and `same` is that highest number (Anki's
 * same-cloze key), absent until the note has a cloze.
 */
export function clozeChoices(fields: Record<string, string>): { next: number; same?: number } {
  const used = Object.values(fields).flatMap((v) => clozeNumbers(v));
  const highest = used.length ? Math.max(...used) : 0;
  return { next: highest + 1, same: highest || undefined };
}

/**
 * `{{c<n>::...}}` around the selection, as Anki's editor wraps it. With nothing selected it puts an
 * empty cloze at the cursor, with the cursor inside it to type the hidden text. The selection
 * afterward is the wrapped text (or that cursor).
 */
export function wrapCloze(text: string, sel: Selection, n: number): Edit {
  const start = Math.max(0, Math.min(sel.start, sel.end, text.length));
  const end = Math.min(text.length, Math.max(sel.start, sel.end));
  const open = `{{c${n}::`;
  const inner = text.slice(start, end);
  return {
    text: `${text.slice(0, start)}${open}${inner}}}${text.slice(end)}`,
    selection: { start: start + open.length, end: start + open.length + inner.length },
  };
}

/**
 * The word of a Tags field being typed: what follows its last space, or '' when the text is empty
 * or ends in a space (a new word not started yet). It's what the tag suggestions (`suggestTags`)
 * are asked for.
 */
export function typedTag(text: string): string {
  return /\S+$/.exec(text)?.[0] ?? '';
}

/** The Tags field with `tag` in place of the word being typed (or after the last tag), then a space for the next one. */
export function applyTagSuggestion(text: string, tag: string): string {
  return `${text.slice(0, text.length - typedTag(text).length)}${tag} `;
}

/**
 * Whether a note being added can be saved with "Save and add another": only one started from
 * nothing. One that opened filled in (a word from Read & Listen, a lesson or a tool) or asking
 * which word was meant is the one note its opener is waiting for.
 */
export function canAddAnother(target: { noteId: string } | { fields?: Record<string, string>; choice?: unknown }): boolean {
  if ('noteId' in target) return false;
  return !target.fields && !target.choice;
}

/**
 * The form after "Save and add another": the fields marked to keep as they were, every other field
 * blank. The deck, note type and tags stay as they are, as in Anki's Add window.
 */
export function nextNoteFields(fieldNames: readonly string[], fields: Record<string, string>, kept: ReadonlySet<string>): Record<string, string> {
  return Object.fromEntries(fieldNames.map((f) => [f, kept.has(f) ? fields[f] ?? '' : '']));
}
