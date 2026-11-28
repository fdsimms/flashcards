import { describe, expect, it } from 'vitest';
import { bulkSummary, notesAfter, repositionPositions, repositionProblem, tagsTyped, withTagsAdded, withTagsRemoved } from '../../src/core/browseActions';
import type { Note } from '../../src/core/types';

describe('tags', () => {
  it('reads tags typed with spaces, each once', () => {
    expect(tagsTyped('  verb  Verb travel ')).toEqual(['verb', 'travel']);
  });
  it('adds case aside, keeping a tag already there as it is', () => {
    expect(withTagsAdded(['Noun'], ['noun', 'travel'])).toEqual(['Noun', 'travel']);
  });
  it("removes as Anki does: case aside, children too, no wildcards", () => {
    expect(withTagsRemoved(['verb', 'verb::regular', 'verb2', 'Noun'], ['VERB', 'n*'])).toEqual(['verb2', 'Noun']);
  });
});

describe('Reposition', () => {
  it('gives each note one place, in order or shuffled', () => {
    expect([...repositionPositions(['a', 'b', 'a', 'c'], 10, 5, false)]).toEqual([['a', 10], ['b', 15], ['c', 20]]);
    expect(new Set(repositionPositions(['a', 'b', 'c'], 1, 1, true, () => 0).values())).toEqual(new Set([1, 2, 3]));
  });
  it('says what to fix', () => {
    expect(repositionProblem('1', '1')).toBeUndefined();
    expect(repositionProblem('x', '1')).toMatch(/Start position/);
    expect(repositionProblem('1', '0')).toMatch(/Step/);
  });
});

describe('what an action did', () => {
  it('says it plainly', () => {
    expect(bulkSummary({ kind: 'suspend' }, 4, 2)).toBe('Suspended 4 cards in 2 notes.');
    expect(bulkSummary({ kind: 'flag', flag: 0 }, 1, 1)).toBe('Took the flag off 1 card in 1 note.');
    expect(bulkSummary({ kind: 'removeTags', tags: ['a', 'b'] }, 3, 3)).toBe('Took a b off 3 notes.');
  });
  it('changes only the notes a move or tag reaches', () => {
    const notes: Note[] = [
      { id: '1', deck: 'A', model: 'Basic', fields: {}, tags: ['x'] },
      { id: '2', deck: 'B', model: 'Basic', fields: {}, tags: [] },
    ];
    expect(notesAfter(notes, { kind: 'deck', deck: 'A' }).map((n) => n.id)).toEqual(['2']);
    expect(notesAfter(notes, { kind: 'addTags', tags: ['x'] }).map((n) => n.id)).toEqual(['2']);
    expect(notesAfter(notes, { kind: 'removeTags', tags: ['x'] }).map((n) => [n.id, n.tags])).toEqual([['1', []]]);
  });
});
