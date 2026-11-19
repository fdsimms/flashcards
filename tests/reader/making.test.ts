import { describe, expect, it } from 'vitest';
import { currentStep, stepsAt, textSteps } from '../../src/reader/making';

describe('textSteps', () => {
  it('marks the steps before a stage done, the stage now and the rest to come', () => {
    expect(textSteps('translating').map((s) => s.status)).toEqual(['done', 'now', 'todo']);
    expect(textSteps('recording').map((s) => s.status)).toEqual(['done', 'done', 'now']);
  });
  it('starts at the first step when the server sends no stage', () => {
    expect(textSteps(undefined).map((s) => s.status)).toEqual(['now', 'todo', 'todo']);
    expect(textSteps(null).map((s) => s.status)).toEqual(['now', 'todo', 'todo']);
  });
  it('names the steps as the card shows them', () => {
    expect(textSteps('writing').map((s) => s.label)).toEqual(['Writing the text', 'Adding the translations', 'Recording the voices']);
  });
});

describe('stepsAt', () => {
  it('reads an unknown stage as the first', () => {
    expect(stepsAt([{ stage: 'a', label: 'A' }, { stage: 'b', label: 'B' }], 'zzz').map((s) => s.status)).toEqual(['now', 'todo']);
  });
});

describe('currentStep', () => {
  it('names the step under way, the first when the server sends no stage', () => {
    expect(currentStep(textSteps('translating'))).toBe('Adding the translations');
    expect(currentStep(textSteps(undefined))).toBe('Writing the text');
  });
});
