// A card page's font: the `@font-face` rules and the rule that sets it. Pure, so it's tested; the files
// themselves are copied where the page can read them by src/media/cardFonts.ts.
import { FONT_WEIGHTS, fontFileName, fontOption, type AppFont } from './fonts';

/** Where the font files go in the documents folder, which card pages can read. Bump it to replace the files. */
export const CARD_FONTS_DIR = 'card-fonts-1';

const MARKER = /\/\*card-font:(\w+)\*\//;

/** The family name a page's rules use, so a deck's own `font-family: Nunito` can't pick up ours by accident. */
const cssFamily = (id: AppFont) => `Franki ${fontOption(id).label}`;

/**
 * The CSS that sets a card page in `id`, or nothing for the system font (a deck's own styling then stands).
 * It goes after the deck's CSS, on `body.card`, which outranks a deck's plain `.card { font-family: arial }`
 * (most imported decks have one) but not a font a deck sets on its own field's class. The system font stays
 * in the list, so a script the family doesn't cover (Thai, Japanese) falls to it as it does on a screen.
 * `base` is the folder's URI with a trailing slash.
 */
export function cardFontCss(id: AppFont, base: string): string {
  const faces = FONT_WEIGHTS.map((w) => ({ w, file: fontFileName(id, w) })).filter((f): f is { w: typeof f.w; file: string } => !!f.file);
  if (faces.length === 0) return '';
  const rules = faces.map((f) => `@font-face { font-family: "${cssFamily(id)}"; font-weight: ${f.w}; src: url("${base}${f.file}"); }`);
  return `/*card-font:${id}*/\n${rules.join('\n')}\nbody.card { font-family: "${cssFamily(id)}", -apple-system, system-ui, sans-serif; }`;
}

/** The font a card page was built with, read back so the files can be put in place before it loads. */
export function pageFont(html: string): AppFont | undefined {
  const id = MARKER.exec(html)?.[1];
  return id && fontOption(id as AppFont).id === id ? (id as AppFont) : undefined;
}
