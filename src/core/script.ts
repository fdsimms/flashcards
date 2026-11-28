import { fontCovers, type AppFont } from './fonts';

/** True when `text` contains Thai script, which is hard to read at body size and gets a larger one. */
export const hasThai = (text: string): boolean => /[\u0E00-\u0E7F]/.test(text);

/** True when `text` contains Cyrillic script, whose letters run wide enough that an example sentence takes a smaller size. */
export const hasCyrillic = (text: string): boolean => /[Ѐ-ӿ]/.test(text);

/**
 * The language tag for a word's `roman` line: the language's own (`speech`) when the line is in its
 * script (Japanese's reading in kana), and none when it is a romanization in Latin letters, which
 * VoiceOver should read as English and which takes the app's font rather than the language's.
 */
export const romanLanguage = (roman: string, speech: string | undefined): string | undefined =>
  /[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\s]/u.test(roman) ? speech : undefined;

/** How large Thai text is drawn on a card: one setting for every deck, this phone's own. */
export type ThaiTextSize = 'normal' | 'large' | 'larger' | 'largest';

/** Font sizes in points; `lineHeight` leaves room for Thai's tone marks and vowels above and below the line. */
export const THAI_TEXT_CHOICES: { value: ThaiTextSize; label: string; fontSize: number; lineHeight: number }[] = [
  { value: 'normal', label: 'Normal', fontSize: 17, lineHeight: 26 },
  { value: 'large', label: 'Large', fontSize: 22, lineHeight: 34 },
  { value: 'larger', label: 'Larger', fontSize: 28, lineHeight: 42 },
  { value: 'largest', label: 'Largest', fontSize: 34, lineHeight: 50 },
];

export const DEFAULT_THAI_TEXT_SIZE: ThaiTextSize = 'large';

/**
 * Room under the last line for Thai's lower vowels (ุ ู) and the tails of ฎ/ฏ. React Native on iOS puts a
 * line height's extra space above the text, so the frame's bottom edge still sits at the font's own
 * descent and cuts a lower vowel flat (สูง); padding grows the frame downward instead.
 */
export const thaiDescentRoom = (fontSize: number): number => Math.round(fontSize * 0.2);

export function thaiTextStyle(size: ThaiTextSize): { fontSize: number; lineHeight: number; paddingBottom: number } {
  const choice = THAI_TEXT_CHOICES.find((c) => c.value === size) ?? THAI_TEXT_CHOICES[1];
  return { fontSize: choice.fontSize, lineHeight: choice.lineHeight, paddingBottom: thaiDescentRoom(choice.fontSize) };
}

/**
 * `base` with a line height tall enough for Thai when `text` has any. A text style that sets only a
 * font size gets the font's default line box, which clips Thai's lower vowels and ฎ/ฏ tails; the
 * headings on a card (`type.cardFront`) set no line height, so they go through this.
 */
export function withThaiLineHeight<T extends { fontSize: number }>(base: T, text: string): T | (T & { lineHeight: number; paddingBottom: number }) {
  return hasThai(text) ? { ...base, lineHeight: Math.round(base.fontSize * 1.5), paddingBottom: thaiDescentRoom(base.fontSize) } : base;
}

/** A stored setting read back; anything unrecognized is the default. */
export function parseThaiTextSize(raw: string | null | undefined): ThaiTextSize {
  return THAI_TEXT_CHOICES.some((c) => c.value === raw) ? (raw as ThaiTextSize) : DEFAULT_THAI_TEXT_SIZE;
}

/**
 * The system's Japanese face. Kanji drawn in the default face fall back to whichever CJK face the
 * phone's languages pick, often a Chinese one, where 直, 骨 and 今 take their Chinese forms.
 */
export const JAPANESE_FONT = 'Hiragino Sans';

/**
 * Japanese's face for `text`, to spread into a style: when it has kana, or kanji in a Japanese
 * context (`speechLang` ja-*), since kanji alone may be Chinese. Empty otherwise, so the style's own
 * face stays, and empty when `font` (the app's or the card's, AppFont.tsx) is a chosen one that draws
 * Japanese itself (Yomogi, Zen Maru Gothic), which a named face would override.
 */
export function japaneseFont(text: string, speechLang: string | null | undefined, font: AppFont): { fontFamily?: string } {
  if (font !== 'system' && fontCovers(font, ['japanese'])) return {};
  const kana = /[぀-ヿ]/.test(text);
  const kanji = /[㐀-䶿一-鿿]/.test(text);
  return kana || (kanji && !!speechLang?.toLowerCase().startsWith('ja')) ? { fontFamily: JAPANESE_FONT } : {};
}
