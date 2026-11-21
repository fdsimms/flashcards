import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { markerText, noteMarkers } from '../../src/core/noteMarkers';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const note = omniNote();
const first = makeCards(note, NOW)[0];
const second: Card = { ...first, id: `${first.noteId}:reverse`, kind: 'reverse' };
const third: Card = { ...first, id: `${first.noteId}:audio`, kind: 'audio' };
const run = (cards: Card[], n = note) => noteMarkers(n, cards, NOW, H);

describe('a note\'s markers in Browse', () => {
  it('shows none for a note whose cards are all ordinary', () => {
    expect(run([first, second])).toEqual([]);
  });

  it('says "all" by naming no count, and "n of m" when only some cards are in the state', () => {
    expect(run([{ ...first, suspended: true }])).toEqual([{ kind: 'suspended', label: 'Suspended' }]);
    const some = run([{ ...first, suspended: true }, second, third]);
    expect(some).toEqual([{ kind: 'suspended', label: 'Suspended', partial: '1 of 3' }]);
    expect(markerText(some[0])).toBe('Suspended, 1 of 3');
  });

  it('marks a bury only for today, and not on a card that is suspended anyway', () => {
    const buriedAt = new Date(2026, 10, 11, 9).toISOString();
    expect(run([{ ...first, buriedAt }, second]).map((m) => m.kind)).toEqual(['buried']);
    expect(run([{ ...first, buriedAt: new Date(2026, 10, 10, 9).toISOString() }])).toEqual([]);
    expect(run([{ ...first, buriedAt, suspended: true }]).map((m) => m.kind)).toEqual(['suspended']);
  });

  it('marks a leech from the note\'s tag, once for the note', () => {
    expect(run([first, second], { ...note, tags: ['leech'] })).toEqual([{ kind: 'leech', label: 'Leech' }]);
  });

  it('names each flag color once, with its own count', () => {
    const m = run([{ ...first, flag: 1 }, { ...second, flag: 4 }, { ...third, flag: 4 }]);
    expect(m).toEqual([
      { kind: 'flag', label: 'Red flag', partial: '1 of 3', flag: 1 },
      { kind: 'flag', label: 'Blue flag', partial: '2 of 3', flag: 4 },
    ]);
  });

  it('ignores a retired card', () => {
    expect(run([{ ...first, suspended: true, retired: true }, second])).toEqual([]);
    expect(run([{ ...first, suspended: true }, { ...second, retired: true }])).toEqual([{ kind: 'suspended', label: 'Suspended' }]);
  });
});
