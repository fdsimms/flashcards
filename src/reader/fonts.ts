// The typeface the reader draws a text in. Pure, so it's tested; Reader.tsx spreads the result into a Text style.
import type { Language } from './api';

/** Thai comes in looped letters (the system face) and loopless ones (Prompt, bundled in app.json). */
export type ThaiFont = 'looped' | 'loopless';

export const THAI_FONTS: ThaiFont[] = ['looped', 'loopless'];

export const THAI_FONT_LABELS: Record<ThaiFont, string> = { looped: 'Looped', loopless: 'Loopless' };

export type ReadFont = {
  /** Unset means the system face. */
  fontFamily?: string;
  /** Used for a practice word. */
  emphasis: { fontFamily?: string; fontWeight: '700' | 'normal' };
};

// PostScript names of the bundled files: iOS finds a font by that name, and a custom family
// asked for at weight 700 gets a synthesized bold, so a practice word uses Prompt's Medium face instead.
const PROMPT_REGULAR = 'Prompt-Regular';
const PROMPT_MEDIUM = 'Prompt-Medium';

export function readFont(language: Language, thaiFont: ThaiFont): ReadFont {
  if (language === 'th' && thaiFont === 'loopless') {
    return { fontFamily: PROMPT_REGULAR, emphasis: { fontFamily: PROMPT_MEDIUM, fontWeight: 'normal' } };
  }
  return { emphasis: { fontWeight: '700' } };
}
