import { describe, expect, it } from 'vitest';
import { cleanDeckName, deckDeletion, deckDeletionWarning, listedDecks, matchParents, renamedDeck, renameProblem, sameDeckName } from '../../src/core/deckNames';
import { newSchedState } from '../../src/core/scheduler';
import type { Card, Note } from '../../src/core/types';

const NOW = new Date(2026, 10, 12, 9);
const note = (id: string, deck: string): Note => ({ id, deck, model: 'Basic', fields: { Front: id, Back: '' }, tags: [] });
const card = (id: string, noteId: string, over: Partial<Card> = {}): Card => ({ id, noteId, kind: 'forward', suspended: false, retired: false, sched: newSchedState(NOW), ...over });

describe('a typed deck name', () => {
  it('is trimmed part by part, in NFC, without control characters, as Anki stores it', () => {
    expect(cleanDeckName('  Polski ::  Odmiana ')).toEqual({ name: 'Polski::Odmiana' });
    expect(cleanDeckName('Café\t1')).toEqual({ name: 'Café1' });
  });

  it('is refused when empty, or with an empty part', () => {
    expect(cleanDeckName('   ')).toEqual({ problem: 'Enter a name for the deck.' });
    expect(cleanDeckName('::')).toEqual({ problem: 'Enter a name for the deck.' });
    expect(cleanDeckName('A::::B')).toHaveProperty('problem');
    expect(cleanDeckName('A::')).toHaveProperty('problem');
  });

  it('matches another without regard to case', () => {
    expect(sameDeckName('Polski', 'POLSKI')).toBe(true);
    expect(sameDeckName('Polski', 'Polska')).toBe(false);
  });
});

describe('renaming', () => {
  it('renames the deck and those under it, not decks that merely share a prefix', () => {
    expect(renamedDeck('A', 'A', 'C')).toBe('C');
    expect(renamedDeck('A::B::C', 'A', 'X::Y')).toBe('X::Y::B::C');
    expect(renamedDeck('A::B::C', 'A::B', 'D')).toBe('D::C');
    expect(renamedDeck('AB', 'A', 'C')).toBeUndefined();
  });

  it('refuses a name inside the deck itself, and one another deck has, a subdeck\'s new name included', () => {
    const decks = ['A', 'A::B', 'C', 'C::B'];
    expect(renameProblem('A', 'a::x', decks)).toMatch("can't go inside itself");
    expect(renameProblem('A', 'c', decks)).toBe('A deck called "C" already exists.');
    expect(renameProblem('A::B', 'c::b', decks)).toBe('A deck called "C::B" already exists.');
    expect(renameProblem('A', 'a', decks)).toBeUndefined();
    expect(renameProblem('A', 'D', decks)).toBeUndefined();
    // "A" to "C" would make "C::B", which C already has.
    expect(renameProblem('A', 'X::C', [...decks, 'X::C::B'])).toBe('A deck called "X::C::B" already exists.');
  });

  it('spells a new name\'s parents as the decks already there', () => {
    expect(matchParents('polski::Nowy', ['Polski', 'Polski::Stary'])).toBe('Polski::Nowy');
    expect(matchParents('polski::stary::Nowy', ['Polski', 'Polski::Stary'])).toBe('Polski::Stary::Nowy');
    expect(matchParents('Nowy', ['nowy'])).toBe('Nowy');
  });
});

describe('the decks listed with no cards', () => {
  it('are every Anki deck but Default, and the decks made here', () => {
    const settings = new Map([['Mine', { created: true }], ['Gated', { gateCap: 5 }]]);
    expect(listedDecks([{ id: 1, name: 'Default' }, { id: 2, name: 'Polski::Empty' }], settings)).toEqual(['Polski::Empty', 'Mine']);
  });
});

describe('what deleting a deck deletes in Franki', () => {
  const notes = [note('n1', 'A'), note('n2', 'A::B'), note('n3', 'Other'), note('n4', 'A'), note('n5', 'AB'), note('n6', 'A::Empty')];
  const cards = [
    card('n1:a', 'n1'), card('n1:b', 'n1', { retired: true }),
    card('n2:a', 'n2'),
    // A note of another deck with one card in A: only that card goes.
    card('n3:a', 'n3'), card('n3:b', 'n3', { deck: 'A::B' }),
    // A note in A whose cards are all elsewhere stays.
    card('n4:a', 'n4', { deck: 'Other' }),
    card('n5:a', 'n5'),
    // In a filtered deck under A, from a deck that stays: it goes back home.
    card('n3:c', 'n3', { deck: 'Other', filteredDeck: 'A::Filtered' }),
    // From A, in a filtered deck elsewhere: deleted with A.
    card('n1:c', 'n1', { filteredDeck: 'Elsewhere' }),
  ];

  it('takes every card whose own deck is under it, the notes left with none, and sends filtered cards home', () => {
    const d = deckDeletion(notes, cards, 'A');
    expect(d.notes.sort()).toEqual(['n1', 'n2', 'n6']);
    expect(d.cards).toEqual(['n3:b']);
    expect(d.returnHome.map((c) => c.id)).toEqual(['n3:c']);
    // The retired card goes too, but isn't counted as one being deleted.
    expect(d.studied.map((c) => c.id).sort()).toEqual(['n1:a', 'n1:c', 'n2:a', 'n3:b']);
  });

  it('leaves the parent of a subdeck alone', () => {
    const d = deckDeletion(notes, cards, 'A::B');
    expect(d.notes).toEqual(['n2']);
    expect(d.cards).toEqual(['n3:b']);
    expect(d.returnHome).toEqual([]);
  });
});

describe('the warning before deleting a deck', () => {
  it('says what goes with it, whether Anki follows, and that it is for good', () => {
    expect(deckDeletionWarning({ cards: 1234, inAnki: true, keepsDeck: false }, 2)).toBe(
      "Its 2 subdecks and 1,234 cards are deleted with it. Anki deletes the same at the next sync, or when you send your collection back. This can't be undone.",
    );
    expect(deckDeletionWarning({ cards: 1, inAnki: false, keepsDeck: false }, 0)).toBe("Its 1 card is deleted with it. This can't be undone.");
    expect(deckDeletionWarning({ cards: 0, inAnki: false, keepsDeck: false }, 0)).toBe("It has no cards. This can't be undone.");
    expect(deckDeletionWarning({ cards: 3, inAnki: true, keepsDeck: true }, 0)).toMatch(/^Its 3 cards are deleted\. Anki always keeps its Default deck, so the deck itself stays, empty\. Anki deletes/);
    expect(deckDeletionWarning({ cards: 0, inAnki: true, keepsDeck: true }, 0)).toBe("Anki always keeps its Default deck, and there are no cards in it to delete. This can't be undone.");
  });
});
