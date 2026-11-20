import { hasCyrillic, hasThai } from './script';

/**
 * Review's face warm-up (src/ui/FaceWarmup.tsx). iOS loads a font face (family and weight) the first
 * time something is laid out in it, and finds a script's fallback glyphs then too. A card's front is
 * set in light weights and its back in heavier, larger ones, so the first flip to a script the session
 * hasn't drawn in a heavy weight paid that cost on the frames of its fade-in. Laying the back's text
 * out in those weights while the front is showing moves the cost there.
 */

/** The weights a card side draws in: its details, a transliteration, its headword and its labels. */
export const WARMED_WEIGHTS = ['400', '500', '600', '700'] as const;

/** The most text laid out per weight: enough to reach every script on the side, never a whole note. */
const WARM_TEXT_LIMIT = 120;

const hasGreek = (text: string): boolean => /[Ͱ-Ͽ]/.test(text);
const hasJapanese = (text: string): boolean => /[぀-ヿ㐀-鿿]/.test(text);

/**
 * What a font's faces have to be warmed for: the font and the scripts in `text`. Two cards with the
 * same key need the same faces, so a session warms each key once.
 */
export function warmupKey(font: string, text: string): string {
  const scripts = [hasThai(text) && 'thai', hasCyrillic(text) && 'cyrillic', hasGreek(text) && 'greek', hasJapanese(text) && 'japanese'].filter(Boolean);
  return `${font}:${scripts.join('+')}`;
}

/** The text to lay out: the side's blocks run together, cut at the limit. */
export function warmupText(blocks: readonly { text: string }[]): string {
  return blocks.map((b) => b.text).join(' ').slice(0, WARM_TEXT_LIMIT);
}
