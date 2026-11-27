// The typeface the reader draws a text in. Pure, so it's tested; Reader.tsx spreads the result into a Text style.
import { fontCovers, resolveFontFace, type AppFont } from '../core/fonts';
import { JAPANESE_FONT } from '../core/script';
import type { Language } from './api';

/** Thai comes in looped letters (the system face) and loopless ones (Prompt, bundled in app.json). */
export type ThaiFont = 'looped' | 'loopless';

export const THAI_FONTS: ThaiFont[] = ['looped', 'loopless'];

/** How much bigger or smaller than a language's own reading size the reader draws a text. */
export type TextSize = 'small' | 'default' | 'large' | 'larger' | 'largest';

export const TEXT_SIZES: TextSize[] = ['small', 'default', 'large', 'larger', 'largest'];

export const TEXT_SIZE_LABELS: Record<TextSize, string> = { small: 'Small', default: 'Default', large: 'Large', larger: 'Larger', largest: 'Largest' };

const TEXT_SIZE_SCALE: Record<TextSize, number> = { small: 0.85, default: 1, large: 1.2, larger: 1.45, largest: 1.75 };

/** The multiplier a text size stands for, over a screen's own sizes. */
export function textScale(size: TextSize): number {
  return TEXT_SIZE_SCALE[size];
}

/** A language's base font size at the chosen text size, to the half point. */
export function scaledFontSize(base: number, size: TextSize): number {
  return Math.round(base * TEXT_SIZE_SCALE[size] * 2) / 2;
}

/**
 * A language's text for a talking point, at the reader's text size: `share` of its reading size
 * (Thai sits bigger than Latin text at the same size) with the line height that language needs.
 */
export function talkTextStyle(info: { fontSize: number; lineHeight: number }, size: TextSize, share = 0.85): { fontSize: number; lineHeight: number } {
  const fontSize = scaledFontSize(info.fontSize * share, size);
  return { fontSize, lineHeight: Math.round(fontSize * info.lineHeight) };
}

export type ReadFont = {
  /** Unset means the system face. */
  fontFamily?: string;
  /** Used for a practice word. */
  emphasis: { fontFamily?: string; fontWeight: '700' | 'normal' };
  /** Semibold text (a line's heading, a chosen answer): the face to spread in place of `fontWeight: '600'`. */
  strong: { fontFamily?: string; fontWeight: '600' | 'normal' };
};

// A bundled family is registered by its PostScript names, so iOS finds a weight by name: asking a custom
// family for weight 700 draws a synthesized bold, which `resolveFontFace` avoids by picking the face itself.
// Prompt has no bold, so a practice word uses its Medium face.
const EMPHASIS_FACE: Partial<Record<AppFont, string>> = { prompt: 'Prompt-Medium' };

/**
 * The faces Read & Listen draws a text of `language` in, for the font chosen for that language (else the
 * app's: `useLanguageFont`). Japanese keeps its own face unless the chosen font draws Japanese itself, so
 * kanji keep their Japanese forms (script.ts); it has real bold weights.
 */
export function readFont(language: Language, font: AppFont = 'system'): ReadFont {
  if (language === 'ja' && (font === 'system' || !fontCovers(font, ['japanese']))) {
    return { fontFamily: JAPANESE_FONT, emphasis: { fontFamily: JAPANESE_FONT, fontWeight: '700' }, strong: { fontFamily: JAPANESE_FONT, fontWeight: '600' } };
  }
  const regular = resolveFontFace(font, 400);
  // `fontFamily: undefined` is a choice (the system face), which the app's font leaves alone; leaving the key out would let it in.
  if (!regular) return { emphasis: { fontWeight: '700' }, strong: { fontFamily: undefined, fontWeight: '600' } };
  return {
    fontFamily: regular,
    emphasis: { fontFamily: EMPHASIS_FACE[font] ?? resolveFontFace(font, 700), fontWeight: 'normal' },
    strong: { fontFamily: resolveFontFace(font, 600), fontWeight: 'normal' },
  };
}

/**
 * The font a language's text was in before fonts were chosen per language: Thai's Looped or Loopless
 * setting, which is now a Thai font (System or Prompt). Used only for a language with no choice made yet.
 */
export function legacyLanguageFont(language: Language, thaiFont: ThaiFont): AppFont | undefined {
  return language === 'th' && thaiFont === 'loopless' ? 'prompt' : undefined;
}
