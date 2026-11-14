import { describe, expect, it } from 'vitest';
import { DEFAULT_SRS, intervalText, nextStage, outcomeText, parseSrsSystem, stageChange, stageName } from '../../src/wanikani/srs';

describe('the popup after an answer', () => {
  it('says nothing for a move within a group', () => {
    expect(stageChange(1, 0)).toBeNull();
    expect(stageChange(5, 0)).toBeNull();
    expect(stageChange(3, 1)).toBeNull();
  });

  it('names the group an item moves up into', () => {
    expect(stageChange(4, 0)).toEqual({ group: 'Guru', up: true, burned: false });
    expect(stageChange(6, 0)).toEqual({ group: 'Master', up: true, burned: false });
    expect(stageChange(7, 0)).toEqual({ group: 'Enlightened', up: true, burned: false });
  });

  it('marks Burned, which ends the item', () => {
    expect(stageChange(8, 0)).toEqual({ group: 'Burned', up: true, burned: true });
  });

  it('names the group an item falls back into', () => {
    expect(stageChange(5, 1)).toEqual({ group: 'Apprentice', up: false, burned: false });
    expect(stageChange(7, 1)).toEqual({ group: 'Guru', up: false, burned: false });
    expect(stageChange(6, 1)).toBeNull();
    expect(stageChange(7, 2)).toEqual({ group: 'Apprentice', up: false, burned: false });
  });

  it('says nothing for an item already burned', () => {
    expect(stageChange(9, 0)).toBeNull();
  });
});

describe('where an answer moves an item', () => {
  it('moves up one when right, and stops at Burned', () => {
    expect(nextStage(1, 0)).toBe(2);
    expect(nextStage(4, 0)).toBe(5);
    expect(nextStage(8, 0)).toBe(9);
    expect(nextStage(9, 0)).toBe(9);
  });

  it('drops by half the misses, rounded up, below Guru', () => {
    expect(nextStage(4, 1)).toBe(3);
    expect(nextStage(4, 2)).toBe(3);
    expect(nextStage(4, 3)).toBe(2);
  });

  it('drops twice as far from Guru up', () => {
    expect(nextStage(5, 1)).toBe(3);
    expect(nextStage(7, 1)).toBe(5);
    expect(nextStage(8, 3)).toBe(4);
  });

  it('never drops below Apprentice 1', () => {
    expect(nextStage(1, 1)).toBe(1);
    expect(nextStage(2, 10)).toBe(1);
  });
});

describe('labels', () => {
  it('names the stages', () => {
    expect(stageName(0)).toBe('Lesson');
    expect(stageName(3)).toBe('Apprentice 3');
    expect(stageName(6)).toBe('Guru 2');
    expect(stageName(9)).toBe('Burned');
  });

  it("rounds WaniKani's just-under intervals to the span they mean", () => {
    expect(intervalText(14400)).toBe('4h');
    expect(intervalText(82800)).toBe('1d');
    expect(intervalText(169200)).toBe('2d');
    expect(intervalText(601200)).toBe('1w');
    expect(intervalText(1206000)).toBe('2w');
    expect(intervalText(2588400)).toBe('1mo');
    expect(intervalText(10364400)).toBe('4mo');
    expect(intervalText(null)).toBe('');
  });

  it('says where a button sends the item and when it comes back', () => {
    expect(outcomeText(5)).toBe('Guru · 1w');
    expect(outcomeText(3)).toBe('Apprentice · 1d');
    expect(outcomeText(9)).toBe('Burned');
    expect(outcomeText(2, DEFAULT_SRS.get(2))).toBe('Apprentice · 4h');
  });
});

describe('reading an SRS system', () => {
  it('turns each stage interval into seconds', () => {
    const s = parseSrsSystem({
      id: 1,
      data: {
        passing_stage_position: 5, burning_stage_position: 9,
        stages: [
          { position: 0, interval: null, interval_unit: null },
          { position: 1, interval: 14400, interval_unit: 'seconds' },
          { position: 2, interval: 8, interval_unit: 'hours' },
          { position: 9, interval: null, interval_unit: null },
        ],
      },
    });
    expect(s).toEqual({ id: 1, intervals: [null, 14400, 28800, null, null, null, null, null, null, null], passingStage: 5, burningStage: 9 });
  });

  it('refuses what is not one', () => {
    expect(parseSrsSystem({ id: 1 })).toBeNull();
    expect(parseSrsSystem(null)).toBeNull();
  });
});
