import { expect, test } from 'vitest';
import { TEXT_SIZES, readFont, scaledFontSize, talkTextStyle } from '../../src/reader/fonts';

test('loopless Thai uses Prompt, and a practice word its Medium face rather than a synthesized bold', () => {
  const font = readFont('th', 'loopless');
  expect(font.fontFamily).toBe('Prompt-Regular');
  expect(font.emphasis).toEqual({ fontFamily: 'Prompt-Medium', fontWeight: 'normal' });
});

test("Japanese takes Japanese's face, with its own bold", () => {
  expect(readFont('ja', 'loopless')).toEqual({ fontFamily: 'Hiragino Sans', emphasis: { fontFamily: 'Hiragino Sans', fontWeight: '700' } });
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

test('a talking point is drawn at a share of the language size, scaled by the text size, with room for Thai marks', () => {
  const thai = { fontSize: 23, lineHeight: 1.75 };
  expect(talkTextStyle(thai, 'default')).toEqual({ fontSize: 19.5, lineHeight: 34 });
  expect(talkTextStyle(thai, 'largest').fontSize).toBeGreaterThan(talkTextStyle(thai, 'large').fontSize);
  expect(talkTextStyle(thai, 'default', 1).fontSize).toBe(23);
});
