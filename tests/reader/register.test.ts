import { expect, test } from 'vitest';
import { isOff, registerLabel, verdictLabel } from '../../src/reader/register';

test('a register is shown with a capital, and nothing is shown for an unknown or missing one', () => {
  expect(registerLabel('casual')).toBe('Casual');
  expect(registerLabel('slang')).toBe('Slang');
  // A text from before registers, and a server older than that.
  expect(registerLabel('')).toBeNull();
  expect(registerLabel(undefined)).toBeNull();
  // Not a key of the list, whatever the server sends or the object inherits.
  expect(registerLabel('rude')).toBeNull();
  expect(registerLabel('toString')).toBeNull();
});

test('each verdict has a label, and only a natural line is not flagged', () => {
  expect(verdictLabel('natural')).toBe('Natural');
  expect(verdictLabel('stiff')).toBe('Stiff here');
  expect(verdictLabel('unusual')).toBe('Unusual');
  expect(isOff('natural')).toBe(false);
  expect(isOff('stiff')).toBe(true);
  expect(isOff('unusual')).toBe(true);
});
