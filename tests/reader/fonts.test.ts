import { expect, test } from 'vitest';
import { readFont } from '../../src/reader/fonts';

test('loopless Thai uses Prompt, and a practice word its Medium face rather than a synthesized bold', () => {
  const font = readFont('th', 'loopless');
  expect(font.fontFamily).toBe('Prompt-Regular');
  expect(font.emphasis).toEqual({ fontFamily: 'Prompt-Medium', fontWeight: 'normal' });
});

test('looped Thai and every other language keep the system face', () => {
  expect(readFont('th', 'looped')).toEqual({ emphasis: { fontWeight: '700' } });
  expect(readFont('es', 'loopless')).toEqual({ emphasis: { fontWeight: '700' } });
});
