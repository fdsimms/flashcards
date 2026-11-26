import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeMisses, missReasonsFor, missReminder } from '../../src/core/misses';
import { carriedRecalled, isSenseMiss, lastMissedSenses, numberedSenses, senseCountLabel, senseMissKey, senseReminder, senseReminderParts, sensesGot } from '../../src/core/senseMarks';
import { omniNote } from '../support/fixtures';

describe('senseMarks', () => {
  it('carries the senses the latest answer recalled, and nothing when none was missed', () => {
    expect(carriedRecalled(3, [2])).toEqual([1, 3]);
    expect(carriedRecalled(2, [1, 2])).toEqual([]);
    expect(carriedRecalled(2, [])).toEqual([]);
  });

  it('reads the senses of a Meaning that numbers them, and none of one that does not', () => {
    expect(numberedSenses('1. train\n2. move (in a game)\n3) draft (of air)')).toEqual(['train', 'move (in a game)', 'draft (of air)']);
    expect(numberedSenses('fame; glory')).toEqual([]);
    // One numbered line is one sense, and a line without a number makes it not a list of senses.
    expect(numberedSenses('1. bait')).toEqual([]);
    expect(numberedSenses('1. train\nalso a move')).toEqual([]);
    expect(numberedSenses('')).toEqual([]);
  });

  it('keeps the marked senses as one reason, in order, and none as no reason', () => {
    expect(senseMissKey([2])).toBe('sense:2');
    expect(senseMissKey(new Set([3, 1, 3]))).toBe('sense:1,3');
    expect(senseMissKey([])).toBeUndefined();
    expect(isSenseMiss('sense:2')).toBe(true);
    expect(isSenseMiss('meaning')).toBe(false);
    expect(isSenseMiss(undefined)).toBe(false);
  });

  it('reminds from the latest answer only, so an answer without a mark clears it', () => {
    expect(lastMissedSenses([undefined, 'sense:2'], 3)).toEqual([2]);
    expect(lastMissedSenses(['sense:1,3'], 3)).toEqual([1, 3]);
    expect(lastMissedSenses(['sense:2', undefined], 3)).toEqual([]);
    expect(lastMissedSenses(['sense:2', 'tone'], 3)).toEqual([]);
    expect(lastMissedSenses([], 3)).toEqual([]);
  });

  it('leaves the reminder off when the Meaning no longer has that sense', () => {
    expect(lastMissedSenses(['sense:3'], 2)).toEqual([]);
    expect(lastMissedSenses(['sense:2'], 0)).toEqual([]);
    expect(lastMissedSenses(['sense:x'], 3)).toEqual([]);
  });

  it('says how many senses were missed and never which', () => {
    expect(senseReminder(3, [2])).toBe('3 senses. You missed one last time.');
    expect(senseReminder(3, [1, 3])).toBe('3 senses. You missed two last time.');
    expect(senseReminder(2, [1, 2])).toBe('2 senses. You missed all of them last time.');
    expect(senseReminder(3, [])).toBeNull();
    expect(senseReminderParts(2, [1])).toEqual({ title: '2 senses', detail: 'You missed one last time' });
    expect(senseReminderParts(2, [])).toBeNull();
    expect(sensesGot(['train', 'move (in a game)', 'draft (of air)'], [2])).toEqual(['train', 'draft (of air)']);
  });

  it('is not a reason the "Last time" line names, though it counts as an answer there', () => {
    const offered = missReasonsFor(omniNote());
    expect(missReminder(['sense:2'], offered)).toBeNull();
    expect(missReminder(['tone', 'sense:2'], offered)).toBe('Last time: tone was wrong');
    expect(activeMisses(['tone', 'sense:2', 'sense:1'])).not.toContain('tone');
  });

  it('is never read by what schedules or builds the queue', () => {
    const root = join(__dirname, '..', '..', 'src', 'core');
    for (const file of ['scheduler.ts', 'queue.ts', 'deckTree.ts', 'order.ts', 'session.ts']) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toMatch(/senseMarks|isSenseMiss/);
    }
    expect(readFileSync(join(root, 'senseMarks.ts'), 'utf8')).not.toMatch(/from '\.\/(scheduler|queue|deckTree|order|session)'/);
  });
});

describe('senseCountLabel', () => {
  it('says how many meanings there are, from two', () => {
    expect(senseCountLabel(2)).toBe('2 meanings');
    expect(senseCountLabel(4)).toBe('4 meanings');
  });
  it('says nothing where there is nothing to count', () => {
    expect(senseCountLabel(1)).toBeNull();
    expect(senseCountLabel(0)).toBeNull();
  });
});
