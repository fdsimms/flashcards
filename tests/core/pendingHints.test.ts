import { describe, expect, it } from 'vitest';
import { addPendingHint, removePendingHint, removePendingHintForCard, type PendingHint } from '../../src/core/pendingHints';

const a: PendingHint = { noteId: 'n1', cardId: 'c1', misses: 8 };
const b: PendingHint = { noteId: 'n2', cardId: 'c2', misses: 9, suspendedCardId: 'c2' };

describe('pending hints', () => {
  it('adds leeches in the order they happened', () => {
    expect(addPendingHint(addPendingHint([], a), b)).toEqual([a, b]);
  });

  it('keeps one entry per note, in its place, with the newer miss count', () => {
    const list = addPendingHint([a, b], { noteId: 'n1', cardId: 'c1b', misses: 10 });
    expect(list.map((h) => h.noteId)).toEqual(['n1', 'n2']);
    expect(list[0]).toMatchObject({ cardId: 'c1b', misses: 10 });
  });

  it('keeps a suspended card the note already had when the second card suspended none', () => {
    const list = addPendingHint([b], { noteId: 'n2', cardId: 'c2b', misses: 9 });
    expect(list[0].suspendedCardId).toBe('c2');
  });

  it('takes a leech off when its answer is undone, and ignores a card that is not on the list', () => {
    expect(removePendingHintForCard([a, b], 'c1')).toEqual([b]);
    const list = [a];
    expect(removePendingHintForCard(list, 'other')).toBe(list);
  });

  it('takes a note off once its hint is saved or skipped', () => {
    expect(removePendingHint([a, b], 'n2')).toEqual([a]);
  });
});
