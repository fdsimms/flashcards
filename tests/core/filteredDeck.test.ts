import { describe, expect, it } from 'vitest';
import { browseSearch, deckTerm, filteredDeckProblem, gatherSearch, newFilteredDeck } from '../../src/core/filteredDeck';

describe('a filtered deck form', () => {
  const ok = { ...newFilteredDeck('is:due'), name: 'Polski due' };
  it("starts as Anki's does", () => {
    expect(newFilteredDeck()).toEqual({ name: '', terms: [{ search: '', limit: 100, order: 1 }], reschedule: true, previewAgainSecs: 60, previewHardSecs: 600, previewGoodSecs: 0 });
  });
  it('says what to change', () => {
    expect(filteredDeckProblem(ok)).toBeUndefined();
    expect(filteredDeckProblem({ ...ok, name: '  ' })).toBe('Enter a name for the deck.');
    expect(filteredDeckProblem({ ...ok, terms: [{ search: 'is:', limit: 10, order: 1 }] })).toMatch(/^The search can't be read\./);
    expect(filteredDeckProblem({ ...ok, terms: [{ search: 'is:new', limit: 0, order: 1 }] })).toBe("The search's limit has to be a whole number from 1 to 99999.");
    expect(filteredDeckProblem({ ...ok, terms: [ok.terms[0], { search: 'x', limit: 5, order: 42 }] })).toBe("The second search's order isn't one Anki has.");
  });
});

describe('searches', () => {
  it("adds Anki's exclusions to what's typed", () => {
    expect(gatherSearch('is:due or is:new')).toBe('(is:due or is:new) -is:suspended -is:buried -deck:filtered');
    expect(gatherSearch(' ')).toBe('-is:suspended -is:buried -deck:filtered');
  });
  it('quotes and escapes a deck name', () => {
    expect(deckTerm('Polski')).toBe('deck:Polski');
    expect(deckTerm('🧠 Trivia')).toBe('"deck:🧠 Trivia"');
    expect(deckTerm('A_b*')).toBe('deck:A\\_b\\*');
  });
  it("folds Browse's deck and filter chips into the search", () => {
    expect(browseSearch('kot', null, null)).toBe('kot');
    expect(browseSearch('kot or pies', 'Polski', 'due')).toBe('deck:Polski is:due (kot or pies)');
    expect(browseSearch('', 'Polski', 'flagged')).toBe('deck:Polski -flag:0');
  });
});
