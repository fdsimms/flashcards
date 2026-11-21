import { describe, expect, it } from 'vitest';
import { LEECH_RECOVERED_DAYS, leechRecovered, withoutLeechTag } from '../../src/core/leechRecovery';
import type { Card, Note } from '../../src/core/types';
import { NOW } from '../support/fixtures';

const note = (tags: string[] = ['leech']): Note => ({ id: 'n', deck: 'Thai', model: 'Omnilanguage', fields: { Entry: 'n', Meaning: '' }, tags });

function card(id: string, over: Partial<Card['sched']> & { suspended?: boolean; retired?: boolean; noteId?: string } = {}): Card {
  const { suspended = false, retired = false, noteId = 'n', ...sched } = over;
  return {
    id, noteId, kind: 'forward', suspended, retired,
    sched: { due: NOW.toISOString(), stability: 30, difficulty: 5, elapsedDays: 0, scheduledDays: LEECH_RECOVERED_DAYS, learningSteps: 0, reps: 30, lapses: 9, state: 2, lastReview: null, ...sched },
  };
}

describe('leech recovery', () => {
  it('is recovered once the card is a review scheduled the mature interval out', () => {
    expect(leechRecovered(note(), [card('a')])).toBe(true);
    expect(leechRecovered(note(), [card('a', { scheduledDays: LEECH_RECOVERED_DAYS - 1 })])).toBe(false);
  });

  it('is not recovered while the card is learning or relearning', () => {
    expect(leechRecovered(note(), [card('a', { state: 3 })])).toBe(false);
    expect(leechRecovered(note(), [card('a', { state: 1 })])).toBe(false);
  });

  it('waits for every studied card of the note', () => {
    expect(leechRecovered(note(), [card('a'), card('b', { scheduledDays: 5 })])).toBe(false);
    expect(leechRecovered(note(), [card('a'), card('b')])).toBe(true);
  });

  it('ignores a card of the note never studied, suspended or not', () => {
    expect(leechRecovered(note(), [card('a'), card('b', { state: 0, scheduledDays: 0 })])).toBe(true);
    expect(leechRecovered(note(), [card('a'), card('b', { state: 0, scheduledDays: 0, suspended: true })])).toBe(true);
    expect(leechRecovered(note(), [card('b', { state: 0, scheduledDays: 0 })])).toBe(false);
  });

  it('is held back by a suspended card, and ignores retired ones and other notes', () => {
    expect(leechRecovered(note(), [card('a', { suspended: true })])).toBe(false);
    expect(leechRecovered(note(), [card('a'), card('b', { retired: true, scheduledDays: 1 })])).toBe(true);
    expect(leechRecovered(note(), [card('a'), card('c', { noteId: 'other', scheduledDays: 1 })])).toBe(true);
  });

  it('needs the leech tag, whatever its case, and at least one studied card', () => {
    expect(leechRecovered(note([]), [card('a')])).toBe(false);
    expect(leechRecovered(note(['Leech']), [card('a')])).toBe(true);
    expect(leechRecovered(note(), [])).toBe(false);
    expect(leechRecovered(note(), [card('a', { retired: true })])).toBe(false);
  });

  it('takes only the leech tag off', () => {
    expect(withoutLeechTag(['verb', 'Leech', 'travel'])).toEqual(['verb', 'travel']);
  });
});
