import type { DueDateSpec } from './reschedule';
import type { Card, Note } from './types';

/**
 * What Browse's Select mode can do to the notes picked (Anki's browser in its notes mode): each
 * action reaches every live card of those notes, Reposition only their new ones. The writes are
 * src/anki/browseActionService.ts.
 */
export type BulkAction =
  | { kind: 'suspend' }
  | { kind: 'unsuspend' }
  | { kind: 'bury' }
  | { kind: 'flag'; flag: number }
  | { kind: 'deck'; deck: string }
  | { kind: 'addTags'; tags: string[] }
  | { kind: 'removeTags'; tags: string[] }
  | { kind: 'dueDate'; spec: DueDateSpec }
  | { kind: 'forget'; resetCounts: boolean }
  | { kind: 'reposition'; start: number; step: number; randomize: boolean; shift: boolean };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cardsIn = (cards: number, notes: number) => `${plural(cards, 'card', 'cards')} in ${plural(notes, 'note', 'notes')}`;

/** What an action did, as the bar's line says it ("Suspended 4 cards in 2 notes."). */
export function bulkSummary(action: BulkAction, cards: number, notes: number): string {
  switch (action.kind) {
    case 'suspend': return `Suspended ${cardsIn(cards, notes)}.`;
    case 'unsuspend': return `Unsuspended ${cardsIn(cards, notes)}.`;
    case 'bury': return `Buried ${cardsIn(cards, notes)} until tomorrow.`;
    case 'flag': return action.flag ? `Flagged ${cardsIn(cards, notes)}.` : `Took the flag off ${cardsIn(cards, notes)}.`;
    case 'deck': return `Moved ${plural(notes, 'note', 'notes')} to ${action.deck}.`;
    case 'addTags': return `Tagged ${plural(notes, 'note', 'notes')} ${action.tags.join(' ')}.`;
    case 'removeTags': return `Took ${action.tags.join(' ')} off ${plural(notes, 'note', 'notes')}.`;
    case 'dueDate': return `Set the due date of ${cardsIn(cards, notes)}.`;
    case 'forget': return `Forgot ${cardsIn(cards, notes)}.`;
    case 'reposition': return `Repositioned ${plural(cards, 'new card', 'new cards')}.`;
  }
}

/** Tags typed with spaces between, as Anki reads them: empty ones dropped, each once. */
export function tagsTyped(text: string): string[] {
  const out: string[] = [];
  for (const t of text.split(/\s+/)) if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

/** A note's tags with `add` added, case aside (a tag it has already keeps its own case). */
export function withTagsAdded(tags: string[], add: string[]): string[] {
  const out = [...tags];
  for (const t of add) if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

/**
 * A note's tags with `remove` taken off, as Anki's Remove Tags matches them: case aside, a tag's
 * children with it (`verb` takes `verb::regular` too, not `verb2`), and no wildcards (`*` is a letter).
 */
export function withTagsRemoved(tags: string[], remove: string[]): string[] {
  const gone = remove.map((r) => r.toLowerCase());
  return tags.filter((t) => !gone.some((g) => t.toLowerCase() === g || t.toLowerCase().startsWith(`${g}::`)));
}

/** Whether every live card of the notes is suspended already, so the bar offers Unsuspend instead. */
export function allSuspended(cards: Card[]): boolean {
  const live = cards.filter((c) => !c.retired);
  return live.length > 0 && live.every((c) => c.suspended);
}

/** The live cards of the notes picked, in the notes' order. */
export function cardsOfNotes(noteIds: string[], cards: Card[]): Card[] {
  const order = new Map(noteIds.map((id, i) => [id, i]));
  return cards.filter((c) => !c.retired && order.has(c.noteId)).sort((a, b) => order.get(a.noteId)! - order.get(b.noteId)!);
}

/**
 * New positions as Anki's Reposition gives them (rslib's `NewCardSorter`): one per note, from
 * `start` in steps of `step`, in the order given or shuffled; every new card of a note takes its
 * note's. `noteIds` are the notes of the new cards being moved, in order.
 */
export function repositionPositions(noteIds: string[], start: number, step: number, randomize: boolean, random: () => number = Math.random): Map<string, number> {
  const unique = [...new Set(noteIds)];
  if (randomize) {
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }
  }
  return new Map(unique.map((id, i) => [id, start + i * step]));
}

/** Why a Reposition can't run as typed, or undefined. */
export function repositionProblem(start: string, step: string): string | undefined {
  if (!/^\d+$/.test(start.trim())) return 'Start position has to be a whole number, e.g. 1.';
  if (!/^\d+$/.test(step.trim()) || Number(step) < 1) return 'Step has to be a whole number of 1 or more.';
  return undefined;
}

/** The notes a change of deck or tags changes, as they'll be: the rest are left out. */
export function notesAfter(notes: Note[], action: BulkAction): Note[] {
  switch (action.kind) {
    case 'deck': return notes.filter((n) => n.deck !== action.deck).map((n) => ({ ...n, deck: action.deck }));
    case 'addTags': return notes.map((n) => ({ ...n, tags: withTagsAdded(n.tags, action.tags) })).filter((n, i) => n.tags.length !== notes[i].tags.length);
    case 'removeTags': return notes.map((n) => ({ ...n, tags: withTagsRemoved(n.tags, action.tags) })).filter((n, i) => n.tags.length !== notes[i].tags.length);
    default: return [];
  }
}
