import { describe, expect, it } from 'vitest';
import { WaniKaniError } from '../../src/wanikani/api';
import { flushSynonyms, queueSynonym, withPending, type SynonymChange } from '../../src/wanikani/synonyms';

const add = (synonym: string, subjectId = 1): SynonymChange => ({ subjectId, synonym });
const remove = (synonym: string, subjectId = 1): SynonymChange => ({ subjectId, synonym, remove: true });

describe('queueing synonym changes', () => {
  it('keeps changes in order and does not queue the same one twice', () => {
    expect(queueSynonym([add('a')], add('b'))).toEqual([add('a'), add('b')]);
    expect(queueSynonym([add('a')], add(' A '))).toEqual([add('a')]);
  });

  it('cancels a save that is taken back before it was sent', () => {
    expect(queueSynonym([add('a'), add('b')], remove('a'))).toEqual([add('b')]);
    expect(queueSynonym([], remove('a'))).toEqual([remove('a')]);
  });
});

describe('synonyms with changes waiting', () => {
  it('adds and removes only for the word asked', () => {
    const q = [add('one stand'), remove('big kid'), add('other', 2)];
    expect(withPending(1, ['big kid'], q)).toEqual(['one stand']);
    expect(withPending(2, [], q)).toEqual(['other']);
  });
});

describe('sending synonym changes', () => {
  it('stops at a problem that could pass later and keeps the rest', async () => {
    const sent: string[] = [];
    const r = await flushSynonyms([add('a'), add('b'), add('c')], async (c) => {
      if (c.synonym === 'b') throw new WaniKaniError('unavailable');
      sent.push(c.synonym);
    });
    expect(sent).toEqual(['a']);
    expect(r).toEqual({ left: [add('b'), add('c')], problem: 'unavailable' });
  });

  it('drops one WaniKani refuses and goes on', async () => {
    const sent: string[] = [];
    const r = await flushSynonyms([add('a'), add('b')], async (c) => {
      if (c.synonym === 'a') throw new WaniKaniError('rejected', 422);
      sent.push(c.synonym);
    });
    expect(sent).toEqual(['b']);
    expect(r).toEqual({ left: [] });
  });
});
