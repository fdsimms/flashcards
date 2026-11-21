import { describe, expect, it } from 'vitest';
import { formatSteps, ownValuesNote, parsePresetForm, parseSteps, presetForm, sameOptions, type PresetOptions } from '../../src/core/presetOptions';

const OPTIONS: PresetOptions = { newPerDay: 20, reviewsPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], maxInterval: 36500, desiredRetention: 0.9 };

describe('steps', () => {
  it('writes each step in the largest unit it divides into, as Anki does', () => {
    expect(formatSteps([1, 10, 60, 90, 1440, 2880, 0.5, 1.5])).toBe('1m 10m 1h 90m 1d 2d 30s 90s');
    expect(formatSteps([])).toBe('');
  });

  it('reads units, a bare number as minutes, and nothing as no steps', () => {
    expect(parseSteps('1m 10m 1h 1d 30s')).toEqual({ steps: [1, 10, 60, 1440, 0.5] });
    expect(parseSteps(' 5, 25 ')).toEqual({ steps: [5, 25] });
    expect(parseSteps('')).toEqual({ steps: [] });
  });

  it('refuses a word, a unit it does not know and a step of 0', () => {
    expect(parseSteps('10 minutes')).toHaveProperty('error');
    expect(parseSteps('1w')).toHaveProperty('error');
    expect(parseSteps('0m')).toEqual({ error: 'Each step has to be longer than 0.' });
  });

  it('reads back what it writes', () => {
    const steps = [0.5, 1, 15, 120, 4320];
    expect(parseSteps(formatSteps(steps))).toEqual({ steps });
  });
});

describe('the form', () => {
  it('round-trips the options', () => {
    expect(presetForm(OPTIONS)).toEqual({ newPerDay: '20', reviewsPerDay: '200', learnSteps: '1m 10m', relearnSteps: '10m', maxInterval: '36500', desiredRetention: '0.90' });
    expect(parsePresetForm(presetForm(OPTIONS))).toEqual({ options: OPTIONS });
  });

  it('takes a retention as a percentage too', () => {
    expect(parsePresetForm({ ...presetForm(OPTIONS), desiredRetention: '85%' })).toEqual({ options: { ...OPTIONS, desiredRetention: 0.85 } });
  });

  it("says what's wrong with every field that can't be used, at Anki's bounds", () => {
    const r = parsePresetForm({ newPerDay: '-1', reviewsPerDay: '10000', learnSteps: 'soon', relearnSteps: '10m', maxInterval: '0', desiredRetention: '0.995' });
    expect(r).toEqual({ errors: {
      newPerDay: 'Enter the limit as a whole number.',
      reviewsPerDay: 'Enter a number from 0 to 9999.',
      learnSteps: expect.stringContaining('e.g. 10m 1d'),
      maxInterval: 'Enter a number from 1 to 36500.',
      desiredRetention: 'Enter a number from 0.70 to 0.99.',
    } });
    expect(parsePresetForm({ ...presetForm(OPTIONS), desiredRetention: '0.70', newPerDay: '0' })).toHaveProperty('options');
  });

  it('compares steps as Anki keeps them, in float32', () => {
    expect(sameOptions(OPTIONS, { ...OPTIONS, learnSteps: [1.0000001, 10] })).toBe(true);
    expect(sameOptions(OPTIONS, { ...OPTIONS, learnSteps: [1, 15] })).toBe(false);
    expect(sameOptions(OPTIONS, { ...OPTIONS, desiredRetention: 0.91 })).toBe(false);
  });
});

describe("a deck's own values", () => {
  it('says which values the preset does not reach', () => {
    expect(ownValuesNote({})).toBeUndefined();
    expect(ownValuesNote({ newPerDay: 3 })).toBe("Has its own new card limit, set in Anki, so the one here doesn't change it.");
    expect(ownValuesNote({ newPerDay: 3, reviewsPerDay: 50, desiredRetention: 0.8 })).toBe("Has its own new card limit, review limit and desired retention, set in Anki, so the ones here don't change them.");
    expect(ownValuesNote({ newToday: true })).toBe('Has a new card limit for today only, so a new limit here starts tomorrow.');
  });
});
