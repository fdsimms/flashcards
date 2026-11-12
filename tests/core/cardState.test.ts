import { describe, expect, it } from 'vitest';
import { cardStateOf, noteCards, withCardState } from '../../src/core/cardState';
import { makeCards } from '../../src/core/cards';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const card = makeCards(omniNote(), NOW)[0];
const sibling: Card = { ...card, id: `${card.noteId}:reverse`, kind: 'reverse' };

describe('a card\'s state from the review menu', () => {
  it('reads suspended, buried today and the flag', () => {
    expect(cardStateOf(card, NOW, H)).toEqual({ suspended: false, buried: false, flag: 0 });
    const marked: Card = { ...card, suspended: true, buriedAt: new Date(2026, 10, 11, 9).toISOString(), flag: 3 };
    expect(cardStateOf(marked, NOW, H)).toEqual({ suspended: true, buried: true, flag: 3 });
  });

  it('holds a bury until the next study day, as Anki unburies at the rollover', () => {
    const buried = withCardState(card, { suspended: false, buried: true, flag: 0 }, NOW);
    expect(cardStateOf(buried, new Date(2026, 10, 12, 3, 59), H).buried).toBe(true);
    expect(cardStateOf(buried, new Date(2026, 10, 12, 4), H).buried).toBe(false);
  });

  it('applies a state and takes it back off, leaving no flag or bury behind', () => {
    const set = withCardState(card, { suspended: true, buried: true, flag: 7 }, NOW);
    expect([set.suspended, set.flag, !!set.buriedAt]).toEqual([true, 7, true]);
    const cleared = withCardState(set, { suspended: false, buried: false, flag: 0 }, NOW);
    expect([cleared.suspended, cleared.flag, cleared.buriedAt]).toEqual([false, undefined, undefined]);
  });

  it("stamps an Anki card's mod, which Anki's review order is seeded from, and not a Franki-only one", () => {
    expect(withCardState({ ...card, ankiId: '5', ankiMod: 1 }, cardStateOf(card, NOW, H), NOW).ankiMod).toBe(Math.floor(NOW.getTime() / 1000));
    expect(withCardState(card, cardStateOf(card, NOW, H), NOW).ankiMod).toBeUndefined();
  });

  it("buries the note's studied cards, leaving out a suspended or retired one and other notes", () => {
    const other: Card = { ...card, id: 'n2:forward', noteId: 'n2' };
    expect(noteCards(card, [card, sibling, other]).map((c) => c.id)).toEqual([card.id, sibling.id]);
    expect(noteCards(card, [card, { ...sibling, suspended: true }])).toEqual([card]);
    expect(noteCards(card, [card, { ...sibling, retired: true }])).toEqual([card]);
  });
});
