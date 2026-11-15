import { expect, test } from 'vitest';
import { LEVEL_HELP, LEVEL_OPTIONS, levelOf } from '../../src/reader/difficulty';

test('the target the server sends is read as standard or easier', () => {
  expect(levelOf(0.95)).toBe('standard');
  expect(levelOf(0.96)).toBe('easier');
  expect(levelOf(0.97)).toBe('easier');
});

test('the two choices are labeled and described', () => {
  expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['standard', 'easier']);
  expect(LEVEL_HELP).toContain('95%');
  expect(LEVEL_HELP).toContain('97%');
  expect(LEVEL_HELP).not.toContain('—');
});
