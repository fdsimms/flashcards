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
  expect(LEVEL_HELP).toContain('93%');
  expect(LEVEL_HELP).toContain('below the 95%');
  expect(LEVEL_HELP).toContain('95%');
  expect(LEVEL_HELP).toContain('97%');
  expect(LEVEL_HELP).not.toContain('—');
});
