import { describe, expect, it } from 'vitest';
import { minedNote, minedOne, MINING_PER_DAY, miningLeft, parseMiningCount } from '../../src/reader/mining';

describe('adding marked words to the deck', () => {
  it('allows MINING_PER_DAY a study day, counting again on a new day', () => {
    expect(miningLeft(null, '2026-11-12')).toBe(MINING_PER_DAY);
    let saved = minedOne(null, '2026-11-12');
    saved = minedOne(saved, '2026-11-12');
    expect(saved).toEqual({ day: '2026-11-12', count: 2 });
    expect(miningLeft(saved, '2026-11-12')).toBe(MINING_PER_DAY - 2);
    expect(miningLeft(saved, '2026-11-13')).toBe(MINING_PER_DAY);
    expect(minedOne(saved, '2026-11-13')).toEqual({ day: '2026-11-13', count: 1 });
  });

  it('never goes below none left', () => {
    expect(miningLeft({ day: 'd', count: MINING_PER_DAY + 3 }, 'd')).toBe(0);
  });

  it('reads back what it saved, and starts again from anything else', () => {
    expect(parseMiningCount(JSON.stringify({ day: 'd', count: 3 }))).toEqual({ day: 'd', count: 3 });
    expect(parseMiningCount(null)).toBeNull();
    expect(parseMiningCount('nope')).toBeNull();
    expect(parseMiningCount(JSON.stringify({ day: 'd', count: 'x' }))).toBeNull();
  });

  it('starts the note as an Omnilanguage note with the word and its meaning', () => {
    expect(minedNote('ทอน', 'give change', 'Thai')).toEqual({ deck: 'Thai', model: 'Omnilanguage', fields: { Entry: 'ทอน', Meaning: 'give change' } });
    expect(minedNote('ทอน', null, 'Thai').fields.Meaning).toBe('');
  });
});
