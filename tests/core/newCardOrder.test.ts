import { describe, expect, it } from 'vitest';
import { newCardOrderNote, newCardOrderOf } from '../../src/core/newCardOrder';
import { DEFAULT_ORDER } from '../../src/core/order';
import type { DeckParams } from '../../src/core/types';

const p = (presetId: number | undefined, newMix = 0, extra: Partial<DeckParams> = {}): DeckParams =>
  ({ weights: [], desiredRetention: 0.9, maxInterval: 36500, presetId, order: { ...DEFAULT_ORDER, newMix }, ...extra });

describe("a deck's new card order", () => {
  const params = new Map([
    ['Languages', p(1, 1)],
    ['Languages::Thai', p(1, 1)],
    ['Languages::Polish', p(2, 0)],
    ['Trivia', p(1, 1)],
    ['Practice', p(undefined, 0, { filtered: { reschedule: true } })],
  ]);

  it("reads the opened deck's preset and the other decks that use it", () => {
    expect(newCardOrderOf('Languages', params)).toEqual({ presetId: 1, mix: 1, sharedWith: ['Languages::Thai', 'Trivia'] });
  });

  it("doesn't count a subdeck on another preset", () => {
    expect(newCardOrderOf('Languages::Polish', params)).toEqual({ presetId: 2, mix: 0, sharedWith: [] });
  });

  it("uses the nearest parent's preset for a deck with none of its own", () => {
    expect(newCardOrderOf('Languages::Thai::Verbs', params)).toEqual({ presetId: 1, mix: 1, sharedWith: ['Languages', 'Languages::Thai', 'Trivia'] });
  });

  it('has none for a filtered deck or a deck Anki does not have', () => {
    expect(newCardOrderOf('Practice', params)).toBeUndefined();
    expect(newCardOrderOf('Elsewhere', params)).toBeUndefined();
  });

  it('says what else a change applies to', () => {
    expect(newCardOrderNote(0)).toBe('It syncs to your other devices.');
    expect(newCardOrderNote(1)).toContain('1 other deck uses');
    expect(newCardOrderNote(14)).toContain('14 other decks use');
  });
});
