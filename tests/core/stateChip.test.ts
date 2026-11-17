import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { stateChip } from '../../src/core/stateChip';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const base = makeCards(omniNote(), NOW)[0];
const card = (state: number, learningSteps = 0): Card => ({ ...base, sched: { ...base.sched, state, learningSteps } });
const steps = { learn: [1, 10, 60], relearn: [10] };

describe('the state chip', () => {
  it('marks a new card', () => {
    expect(stateChip(card(0), steps)).toEqual({ kind: 'new' });
  });

  it('shows the step a learning card is on, counted from 1', () => {
    expect(stateChip(card(1, 0), steps)).toEqual({ kind: 'learning', step: { at: 1, of: 3 } });
    expect(stateChip(card(1, 1), steps)).toEqual({ kind: 'learning', step: { at: 2, of: 3 } });
  });

  it('keeps a step past the end of the deck steps on the last one', () => {
    expect(stateChip(card(1, 9), steps)).toEqual({ kind: 'learning', step: { at: 3, of: 3 } });
  });

  it('shows no steps when there is only one to draw', () => {
    expect(stateChip(card(3, 0), steps)).toEqual({ kind: 'relearning' });
    expect(stateChip(card(1, 0), { learn: [], relearn: [] })).toEqual({ kind: 'learning' });
  });

  it('shows nothing for a review card', () => {
    expect(stateChip(card(2), steps)).toBeUndefined();
  });
});
