import { frontFieldName } from '../core/cards';
import { htmlToText } from '../core/html';
import type { Note } from '../core/types';
import type { ImportResult } from './tsv';

/**
 * What makes two notes the same note when their ids differ: the note type and the front field
 * (Entry, Front...), deck ignored. Not lowercased, since case can be the whole difference
 * (German "Weg" and "weg").
 */
export function matchKey(note: Note): string | undefined {
  const name = frontFieldName(note);
  const front = name ? htmlToText(note.fields[name] ?? '').normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  return front ? `${note.model}\u0000${front}` : undefined;
}

/**
 * Point an import's notes at the notes already here, so a re-import updates instead of
 * duplicating when the id it derived differs from the stored one: the same deck exported as TSV
 * and as JSON (`tsv:<deck>:<entry>` against Anki's note id), or a note moved to another deck and
 * exported as TSV again.
 *
 * An incoming note whose id is already stored keeps it. Otherwise it takes the id of the one
 * stored note with the same `matchKey`, and its new deck goes with it. When several stored notes
 * share that key (a homograph like German "Bank", bench and bank), it is imported as new with a
 * warning rather than guessed at. A stored note is matched at most once per import, and never
 * when this import also updates it under its own id.
 */
export function reconcileIds(result: ImportResult, existing: Note[]): ImportResult {
  const existingIds = new Set(existing.map((n) => n.id));
  const incomingIds = new Set(result.notes.map((n) => n.id));
  const byKey = new Map<string, Note[]>();
  for (const n of existing) {
    if (incomingIds.has(n.id)) continue;
    const k = matchKey(n);
    if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(n);
  }

  const warnings = [...result.warnings];
  const remap = new Map<string, string>();
  const claimed = new Set<string>();
  for (const n of result.notes) {
    if (existingIds.has(n.id)) continue;
    const k = matchKey(n);
    const candidates = (k ? byKey.get(k) ?? [] : []).filter((c) => !claimed.has(c.id));
    if (candidates.length === 1) {
      remap.set(n.id, candidates[0].id);
      claimed.add(candidates[0].id);
    } else if (candidates.length > 1) {
      const front = frontFieldName(n);
      warnings.push(
        `"${htmlToText(n.fields[front ?? ''] ?? '')}" matches ${candidates.length} notes already here, so it was added as a new note`,
      );
    }
  }
  if (remap.size === 0) return { ...result, warnings };

  const to = (id: string) => remap.get(id) ?? id;
  return {
    ...result,
    notes: result.notes.map((n) => ({ ...n, id: to(n.id) })),
    cards: result.cards.map((c) => ({ ...c, id: `${to(c.noteId)}:${c.kind}`, noteId: to(c.noteId) })),
    warnings,
  };
}
