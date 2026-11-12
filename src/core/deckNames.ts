import { cardHomeDeck, deckLineage, isInDeck } from './deckTree';
import type { Card, DeckSettings, Note } from './types';

/**
 * Making, renaming and deleting decks, the parts that don't need a database: what a typed name
 * becomes, what a rename does to each name under the deck, and what deleting a deck takes with it
 * in Franki's own tables. The kept Anki collection's side is src/anki/deckEdits.ts; the two are
 * put together in src/anki/deckService.ts.
 */

/**
 * A deck name as typed, the way Anki stores one (rslib/src/decks/name.rs, `from_human_name`):
 * NFC, control characters taken out, each part between "::" trimmed. Anki turns an empty part
 * into "blank"; this says what's wrong instead, so a stray "::" doesn't make a deck called "blank".
 */
export function cleanDeckName(input: string): { name: string } | { problem: string } {
  const parts = input.normalize('NFC').split('::').map((p) => p.replace(/[\x00-\x1f\x7f]/g, '').trim());
  if (parts.every((p) => !p)) return { problem: 'Enter a name for the deck.' };
  if (parts.some((p) => !p)) return { problem: 'Each part of the name between "::" needs some text. Remove the extra "::".' };
  return { name: parts.join('::') };
}

/** Whether two deck names are the same one: Anki compares names without regard to case. */
export function sameDeckName(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/**
 * `deck`'s name once `from` is renamed `to`: "A::B" with "A" renamed "C" is "C::B". Undefined
 * when `deck` isn't `from` or under it.
 */
export function renamedDeck(deck: string, from: string, to: string): string | undefined {
  return isInDeck(deck, from) ? to + deck.slice(from.length) : undefined;
}

/** Why `from` can't be renamed `to`, among the decks `existing` (Franki's names, `from`'s own included), or undefined. */
export function renameProblem(from: string, to: string, existing: Iterable<string>): string | undefined {
  if (deckLineage(to).slice(0, -1).some((d) => sameDeckName(d, from))) {
    return `A deck can't go inside itself. Choose a name that doesn't start with "${from}::".`;
  }
  const others = [...existing].filter((d) => !isInDeck(d, from));
  const moved = [to, ...[...existing].filter((d) => isInDeck(d, from)).map((d) => renamedDeck(d, from, to)!)];
  const taken = others.find((o) => moved.some((m) => sameDeckName(o, m)));
  return taken ? `A deck called "${taken}" already exists.` : undefined;
}

/**
 * `name` with each of its parents spelled as a deck that already exists ("polski::Nowy" under
 * "Polski" is "Polski::Nowy"), as Anki matches a new deck to its parents (`match_or_create_parents`).
 */
export function matchParents(name: string, existing: Iterable<string>): string {
  const all = [...existing];
  const parts = name.split('::');
  for (let i = parts.length - 1; i >= 1; i--) {
    const parent = all.find((d) => sameDeckName(d, parts.slice(0, i).join('::')));
    if (parent) return [parent, ...parts.slice(i)].join('::');
  }
  return name;
}

/**
 * The decks the deck list shows even with no cards in them: every deck in the kept Anki collection
 * but Default (Anki hides Default when it has no cards and no subdecks; with either, it's listed
 * anyway), and each deck made here that Anki doesn't have (`DeckSettings.created`).
 */
export function listedDecks(ankiDecks: { id: number; name: string }[], settings: Map<string, DeckSettings>): string[] {
  const made = [...settings].filter(([, s]) => s.created).map(([d]) => d);
  return [...ankiDecks.filter((d) => d.id !== 1).map((d) => d.name), ...made];
}

/** What deleting a deck deletes from Franki's tables. */
export interface DeckDeletion {
  /** Notes left with no cards, deleted with their cards. */
  notes: string[];
  /** Cards of notes that keep other cards elsewhere. */
  cards: string[];
  /** Cards in a filtered deck being deleted whose own deck stays: they go back to it. */
  returnHome: Card[];
  /** The cards deleted that are studied (not retired): what deleting the deck is said to delete. */
  studied: Card[];
}

/**
 * Deleting `deck` and its subdecks as Anki deletes them (rslib/src/decks/remove.rs): every card
 * whose own deck is among them, wherever it's studied (a filtered deck elsewhere included), then
 * every note left with no cards. A card of another deck that's in a filtered deck among them goes
 * back to its own deck. A note that keeps cards elsewhere keeps its deck name here; it's Anki's
 * (Franki's own notes keep every card in the note's deck), and taking in the collection again
 * gives it its first card's deck.
 */
export function deckDeletion(notes: Note[], cards: Card[], deck: string): DeckDeletion {
  const deckOf = new Map(notes.map((n) => [n.id, n.deck]));
  const gone = cards.filter((c) => isInDeck(cardHomeDeck(c, deckOf.get(c.noteId) ?? 'Imported'), deck));
  const goneIds = new Set(gone.map((c) => c.id));
  const kept = cards.filter((c) => !goneIds.has(c.id));
  const keepNote = new Set(kept.map((c) => c.noteId));
  const hasCards = new Set(cards.map((c) => c.noteId));
  const noteIds = new Set([
    ...gone.map((c) => c.noteId).filter((id) => !keepNote.has(id)),
    // A note with no cards at all goes with its deck.
    ...notes.filter((n) => !hasCards.has(n.id) && isInDeck(n.deck, deck)).map((n) => n.id),
  ]);
  return {
    notes: [...noteIds],
    cards: gone.filter((c) => !noteIds.has(c.noteId)).map((c) => c.id),
    returnHome: kept.filter((c) => c.filteredDeck !== undefined && isInDeck(c.filteredDeck, deck)),
    studied: gone.filter((c) => !c.retired),
  };
}

/**
 * What the deck list says before deleting a deck: what goes with it (`deckDeletionPreview`'s
 * count, and its subdecks), whether Anki follows, and that it can't be undone.
 */
export function deckDeletionWarning(p: { cards: number; inAnki: boolean; keepsDeck: boolean }, subdecks: number): string {
  const count = (n: number, one: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;
  const things = [subdecks ? count(subdecks, 'subdeck') : '', p.cards ? count(p.cards, 'card') : ''].filter(Boolean);
  const single = things.length === 1 && (subdecks || p.cards) === 1;
  const gone = things.length ? `Its ${things.join(' and ')} ${single ? 'is' : 'are'} deleted` : '';
  const lines = p.keepsDeck
    ? [gone ? `${gone}. Anki always keeps its Default deck, so the deck itself stays, empty.` : 'Anki always keeps its Default deck, and there are no cards in it to delete.']
    : [gone ? `${gone} with it.` : 'It has no cards.'];
  if (p.inAnki && (gone || !p.keepsDeck)) lines.push('Anki deletes the same at the next sync, or when you send your collection back.');
  lines.push("This can't be undone.");
  return lines.join(' ');
}
