/** True when `text` contains Thai script, which is hard to read at body size and gets a larger one. */
export const hasThai = (text: string): boolean => /[\u0E00-\u0E7F]/.test(text);

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

export function thaiTextStyle(size: ThaiTextSize): { fontSize: number; lineHeight: number } {
  const choice = THAI_TEXT_CHOICES.find((c) => c.value === size) ?? THAI_TEXT_CHOICES[1];
  return { fontSize: choice.fontSize, lineHeight: choice.lineHeight };
}

/** A stored setting read back; anything unrecognized is the default. */
export function parseThaiTextSize(raw: string | null | undefined): ThaiTextSize {
  return THAI_TEXT_CHOICES.some((c) => c.value === raw) ? (raw as ThaiTextSize) : DEFAULT_THAI_TEXT_SIZE;
}
