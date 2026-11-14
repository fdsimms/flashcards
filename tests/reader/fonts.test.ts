import { expect, test } from 'vitest';
import { TEXT_SIZES, readFont, scaledFontSize } from '../../src/reader/fonts';

test('loopless Thai uses Prompt, and a practice word its Medium face rather than a synthesized bold', () => {
  const font = readFont('th', 'loopless');
  expect(font.fontFamily).toBe('Prompt-Regular');
  expect(font.emphasis).toEqual({ fontFamily: 'Prompt-Medium', fontWeight: 'normal' });
});

test('looped Thai and every other language keep the system face', () => {
  expect(readFont('th', 'looped')).toEqual({ emphasis: { fontWeight: '700' } });
  expect(readFont('es', 'loopless')).toEqual({ emphasis: { fontWeight: '700' } });
});

test('the default text size leaves a language\'s own size alone, and each step up is bigger', () => {
  expect(scaledFontSize(23, 'default')).toBe(23);
  const sizes = TEXT_SIZES.map((s) => scaledFontSize(23, s));
  expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  expect(new Set(sizes).size).toBe(TEXT_SIZES.length);
});
