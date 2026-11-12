import { describe, expect, it } from 'vitest';
import { CUSTOM_STUDY_OPTIONS, customStudyFrom, customStudyProblem, filteredPlan, FILTERED_ORDER, isLimitChange, parseTags, raisedLimit } from '../../src/core/customStudy';

describe('the search a custom study stores', () => {
  it('has none for the options that only raise a limit', () => {
    expect(filteredPlan({ kind: 'moreNew', count: 5 }, 'Polski')).toBeUndefined();
    expect(filteredPlan({ kind: 'moreReviews', count: 5 }, 'Polski')).toBeUndefined();
    expect(isLimitChange({ kind: 'moreNew', count: 5 })).toBe(true);
  });

  it('builds the searches Anki builds', () => {
    expect(filteredPlan({ kind: 'forgotten', days: 3 }, 'Polski')).toEqual({ search: 'deck:"Polski" rated:3:1', limit: 9999, order: FILTERED_ORDER.random, reschedule: false });
    expect(filteredPlan({ kind: 'ahead', days: 2 }, 'Polski')).toEqual({ search: 'deck:"Polski" prop:due<=2', limit: 9999, order: FILTERED_ORDER.due, reschedule: true });
    expect(filteredPlan({ kind: 'previewNew', days: 7 }, 'Polski')).toEqual({ search: 'deck:"Polski" is:new added:7', limit: 9999, order: FILTERED_ORDER.added, reschedule: false });
  });

  it('builds a cram by state, count and tags', () => {
    const cram = (select: 'new' | 'due' | 'review' | 'all', include: string[] = [], exclude: string[] = []) =>
      filteredPlan({ kind: 'cram', select, count: 50, include, exclude }, 'A::B')!;
    expect(cram('new')).toMatchObject({ search: 'deck:"A::B" is:new', limit: 50, order: FILTERED_ORDER.added, reschedule: false });
    expect(cram('due').search).toBe('deck:"A::B" is:due');
    expect(cram('review').search).toBe('deck:"A::B" -is:new');
    expect(cram('all', ['verb', 'a1'], ['noun']).search).toBe('deck:"A::B" (tag:"verb" or tag:"a1") -tag:"noun"');
  });

  it('escapes what a search reads as syntax in a deck or tag name', () => {
    expect(filteredPlan({ kind: 'ahead', days: 1 }, 'My "deck"_*')!.search).toBe('deck:"My \\"deck\\"\\_\\*" prop:due<=1');
  });
});

describe('what a request needs', () => {
  it('wants a whole number from 1 to 9999', () => {
    expect(customStudyProblem({ kind: 'moreNew', count: 10 })).toBeUndefined();
    expect(customStudyProblem({ kind: 'moreNew', count: 0 })).toMatch('cards');
    expect(customStudyProblem({ kind: 'forgotten', days: 1.5 })).toMatch('days');
    expect(customStudyProblem({ kind: 'ahead', days: 10000 })).toMatch('9999');
    expect(customStudyProblem({ kind: 'cram', select: 'all', count: NaN, include: [], exclude: [] })).toMatch('cards');
  });

  it('adds to the limit the deck has', () => {
    expect(raisedLimit(20, 10)).toBe(30);
  });

  it('splits typed tags on spaces and commas, without # or repeats', () => {
    expect(parseTags('verb, #a1  verb,noun')).toEqual(['verb', 'a1', 'noun']);
    expect(parseTags('')).toEqual([]);
  });

  it("turns a sheet's choices into a request", () => {
    expect(customStudyFrom('moreNew', 5)).toEqual({ kind: 'moreNew', count: 5 });
    expect(customStudyFrom('ahead', 3)).toEqual({ kind: 'ahead', days: 3 });
    expect(customStudyFrom('cram', 40, { select: 'due', include: 'a b', exclude: '' })).toEqual({ kind: 'cram', count: 40, select: 'due', include: ['a', 'b'], exclude: [] });
  });

  it('offers every option once, each with a starting amount', () => {
    expect(new Set(CUSTOM_STUDY_OPTIONS.map((o) => o.kind)).size).toBe(6);
    expect(CUSTOM_STUDY_OPTIONS.every((o) => customStudyProblem(customStudyFrom(o.kind, o.field.start)) === undefined)).toBe(true);
  });
});
