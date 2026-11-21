import { expect, test } from 'vitest';
import { LEVEL_HELP, LEVEL_OPTIONS, levelOf } from '../../src/reader/difficulty';

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
