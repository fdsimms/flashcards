import { expect, test } from 'vitest';
import { TEXT_SIZES, legacyLanguageFont, readFont, textScale, scaledFontSize, talkTextStyle } from '../../src/reader/fonts';

test('Prompt gives loopless Thai, and a practice word its Medium face rather than a synthesized bold', () => {
  const font = readFont('th', 'prompt');
  expect(font.fontFamily).toBe('Prompt-Regular');
  expect(font.emphasis).toEqual({ fontFamily: 'Prompt-Medium', fontWeight: 'normal' });
  expect(font.strong).toEqual({ fontFamily: 'Prompt-Regular', fontWeight: 'normal' });
});

test("Japanese takes Japanese's face, with its own bold, unless the font chosen draws Japanese itself", () => {
  const own = { fontFamily: 'Hiragino Sans', emphasis: { fontFamily: 'Hiragino Sans', fontWeight: '700' }, strong: { fontFamily: 'Hiragino Sans', fontWeight: '600' } };
  expect(readFont('ja', 'system')).toEqual(own);
  expect(readFont('ja', 'nunito')).toEqual(own);
  expect(readFont('ja', 'yomogi').fontFamily).toBe('Yomogi-Regular');
});

test('the system face stays system, and says so, so the app font leaves it alone', () => {
  const font = readFont('es');
  expect(font).toEqual({ emphasis: { fontWeight: '700' }, strong: { fontFamily: undefined, fontWeight: '600' } });
  expect('fontFamily' in font.strong).toBe(true);
});

test("a chosen font gives every weight its own face rather than a synthesized bold", () => {
  const font = readFont('ru', 'nunito');
  expect(font.fontFamily).toBe('Nunito-Regular');
  expect(font.emphasis).toEqual({ fontFamily: 'Nunito-Bold', fontWeight: 'normal' });
  expect(font.strong).toEqual({ fontFamily: 'Nunito-SemiBold', fontWeight: 'normal' });
});

test('a Thai reader who chose Loopless keeps it until it is saved as the language font', () => {
  expect(legacyLanguageFont('th', 'loopless')).toBe('prompt');
  expect(legacyLanguageFont('th', 'looped')).toBeUndefined();
  expect(legacyLanguageFont('es', 'loopless')).toBeUndefined();
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

test('a text size is a multiplier over a screen\'s own sizes', () => {
  expect(textScale('default')).toBe(1);
  expect(textScale('small')).toBeLessThan(1);
  expect(textScale('largest')).toBeGreaterThan(textScale('larger'));
});
