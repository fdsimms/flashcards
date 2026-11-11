import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { GURU, isApprentice, nextStage, parseGateCap, stageFromHistory, stageFromSchedule } from '../../src/core/progress';
import { answerCard } from '../../src/core/session';
import { NOW, omniNote } from '../support/fixtures';

describe('nextStage', () => {
  it('meets a card at Apprentice 1 and reaches Guru on the fourth correct review in a row', () => {
    let s = nextStage(0, 0, 3); // first answer of a new card
    expect(s).toBe(1);
    s = nextStage(s, 1, 3); // learning step: no change
    expect(s).toBe(1);
    for (const want of [2, 3, 4, GURU]) {
      s = nextStage(s, 2, 3);
      expect(s).toBe(want);
    }
  });
  it('counts Hard and Easy as correct', () => {
    expect(nextStage(2, 2, 2)).toBe(3);
    expect(nextStage(2, 2, 4)).toBe(3);
  });
  it("drops one stage for a wrong answer below Guru and two from Guru up, as WaniKani does", () => {
    expect(nextStage(3, 2, 1)).toBe(2);
    expect(nextStage(1, 2, 1)).toBe(1);
    expect(nextStage(GURU, 2, 1)).toBe(GURU - 2);
    expect(nextStage(7, 2, 1)).toBe(5);
  });
  it('leaves the stage alone during relearning steps', () => {
    expect(nextStage(3, 3, 3)).toBe(3);
    expect(nextStage(3, 3, 1)).toBe(3);
  });
});

describe('stageFromHistory', () => {
  it('replays Anki review history by the same rule', () => {
    // learn Good, learn Good, then reviews: Good, Good, Again (lapse), relearn Good, Good, Good
    expect(stageFromHistory([3, 3, 13, 13, 11, 23, 13, 13])).toBe(4);
    expect(stageFromHistory([3, 13, 13, 13, 13])).toBe(GURU);
    expect(stageFromHistory([])).toBe(0);
  });
  it('skips reschedules and manual entries', () => {
    expect(stageFromHistory([3, 40, 50, 13])).toBe(2);
  });
});

describe('stageFromSchedule', () => {
  it('guesses Guru for a review a week or more out', () => {
    expect(stageFromSchedule(0, 0)).toBe(0);
    expect(stageFromSchedule(1, 0)).toBe(1);
    expect(stageFromSchedule(2, 3)).toBe(GURU - 1);
    expect(stageFromSchedule(2, 30)).toBe(GURU);
  });
});

describe('isApprentice and answerCard', () => {
  it('counts started cards below Guru, not new ones', () => {
    const [card] = makeCards(omniNote(), NOW);
    expect(isApprentice(card)).toBe(false);
    const met = answerCard(card, 3, NOW).card;
    expect(met.stage).toBe(1);
    expect(isApprentice(met)).toBe(true);
    expect(isApprentice({ ...met, sched: { ...met.sched, state: 2 }, stage: GURU })).toBe(false);
  });
});

describe('parseGateCap', () => {
  it('takes a whole number from 1 to 5000 and says why anything else is refused', () => {
    expect(parseGateCap(' 120 ')).toEqual({ cap: 120 });
    expect(parseGateCap('12.5')).toEqual({ error: 'Enter a whole number, for example 100.' });
    expect(parseGateCap('0')).toHaveProperty('error');
    expect(parseGateCap('9000')).toHaveProperty('error');
  });
});
