import { expect, test } from 'vitest';
import { LEVEL_HELP, LEVEL_OPTIONS, levelOf, newWordsStepNote, stepLevel } from '../../src/reader/difficulty';

test('the target the server sends is read as harder, standard or easier', () => {
  expect(levelOf(0.93)).toBe('harder');
  expect(levelOf(0.95)).toBe('standard');
  expect(levelOf(0.96)).toBe('easier');
  expect(levelOf(0.97)).toBe('easier');
});

test('the three choices are labeled and described, harder with its caveat', () => {
  expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['harder', 'standard', 'easier']);
  expect(LEVEL_HELP).toContain('about 5 new words in 100');
  expect(LEVEL_HELP).toContain('about 3');
  expect(LEVEL_HELP).toContain('about 7, more than research finds you can comfortably follow');
  expect(LEVEL_HELP).not.toContain('—');
});

test('Fewer and More step the level toward 3 and 7 new words in 100, held at the ends', () => {
  expect(stepLevel('standard', 'more')).toBe('harder');
  expect(stepLevel('standard', 'fewer')).toBe('easier');
  expect(stepLevel('standard', 'same')).toBe('standard');
  expect(stepLevel('harder', 'more')).toBe('harder');
  expect(stepLevel('easier', 'fewer')).toBe('easier');
});

test('the note says what the step means, with the caveat at Harder, and nothing for Same', () => {
  expect(newWordsStepNote('standard', 'standard', 'same')).toBeNull();
  expect(newWordsStepNote('easier', 'standard', 'more')).toBe('About 5 new words in 100, up from 3.');
  expect(newWordsStepNote('harder', 'standard', 'fewer')).toBe('About 5 new words in 100, down from 7.');
  expect(newWordsStepNote('standard', 'harder', 'more')).toContain('more than research finds you can comfortably follow');
  expect(newWordsStepNote('harder', 'harder', 'more')).toBe("That's as many as it goes: about 7 new words in 100.");
  expect(newWordsStepNote('easier', 'easier', 'fewer')).toBe("That's as few as it goes: about 3 new words in 100.");
});
