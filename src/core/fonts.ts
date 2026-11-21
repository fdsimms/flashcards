// The typefaces the app can be set in, and which one a card shows. Pure, so it's tested; the screens
// (src/ui/AppFont.tsx) and the card page (cardDocument) read it.
import { fnvHash } from './order';

/**
 * `system` is the absence of a choice: no family, nothing loaded, the phone's own font.
 * Every other id is a family bundled with the app (assets/fonts, listed in app.json).
 */
export type AppFont =
  | 'system' | 'nunito' | 'inter' | 'manrope' | 'comfortaa' | 'sourceSerif' | 'lora' | 'alegreya'
  | 'marckScript' | 'badScript' | 'caveat' | 'mali' | 'sriracha' | 'yomogi' | 'zenKurenaido'
  | 'mitr' | 'charmonman' | 'zenMaru';

/** The weights the app draws. */
export type FontWeightKey = 400 | 600 | 700;

/** The scripts a font may or may not cover. Every bundled font covers Latin with its accents. */
export type Script = 'cyrillic' | 'greek' | 'thai' | 'japanese';

export const SCRIPT_NAMES: Record<Script, string> = { cyrillic: 'Cyrillic', greek: 'Greek', thai: 'Thai', japanese: 'Japanese' };

export type FontGroup = 'everyday' | 'handwritten' | 'stylistic';

export const FONT_GROUPS: { id: FontGroup; title: string }[] = [
  { id: 'everyday', title: 'Everyday' },
  { id: 'handwritten', title: 'Handwritten and script' },
  { id: 'stylistic', title: 'Stylistic' },
];

export interface AppFontOption {
  id: AppFont;
  label: string;
  /** What the face is like, in a line. */
  hint: string;
  group: FontGroup;
  /** The family's name in its file names and PostScript names (`Nunito` for `Nunito-SemiBold`); unset for the system font. */
  family?: string;
  /** The weights bundled. A family with one face draws every weight in it, so bold text isn't bold. */
  weights: FontWeightKey[];
  /** The scripts besides Latin that the family covers. The system font falls back per character, so it covers every one. */
  scripts: Script[];
  /** Not in the app: the files are downloaded when the font is first wanted (`FONT_DOWNLOADS`). */
  download?: true;
}

const ALL_SCRIPTS: Script[] = ['cyrillic', 'greek', 'thai', 'japanese'];
const THREE: FontWeightKey[] = [400, 600, 700];

/**
 * What each file covers was read from the files (a font that lacks one Greek or Cyrillic letter is listed
 * without it). Outfit, Space Grotesk and Bricolage Grotesque were left out: they have no Cyrillic, so a
 * Russian card would fall back to the system font for every letter.
 */
export const APP_FONT_OPTIONS: AppFontOption[] = [
  { id: 'system', label: 'System', hint: "The default. The phone's own font.", group: 'everyday', weights: THREE, scripts: ALL_SCRIPTS },
  { id: 'nunito', label: 'Nunito', hint: 'Rounded, with wide letters.', group: 'everyday', family: 'Nunito', weights: THREE, scripts: ['cyrillic'] },
  { id: 'inter', label: 'Inter', hint: 'Neutral and sharp. Easy to read at small sizes.', group: 'everyday', family: 'Inter', weights: THREE, scripts: ['cyrillic', 'greek'] },
  { id: 'manrope', label: 'Manrope', hint: 'Geometric and even, with round shapes.', group: 'everyday', family: 'Manrope', weights: THREE, scripts: ['cyrillic', 'greek'] },
  { id: 'comfortaa', label: 'Comfortaa', hint: 'Round and light, like Nunito with Greek.', group: 'everyday', family: 'Comfortaa', weights: THREE, scripts: ['cyrillic', 'greek'] },
  { id: 'sourceSerif', label: 'Source Serif 4', hint: 'A book serif with clear accents.', group: 'everyday', family: 'SourceSerif4', weights: THREE, scripts: ['cyrillic', 'greek'] },
  { id: 'lora', label: 'Lora', hint: 'A serif with calligraphic curves.', group: 'everyday', family: 'Lora', weights: THREE, scripts: ['cyrillic'] },
  { id: 'alegreya', label: 'Alegreya', hint: 'A calligraphic serif, like Lora with Greek.', group: 'everyday', family: 'Alegreya', weights: THREE, scripts: ['cyrillic', 'greek'] },
  { id: 'marckScript', label: 'Marck Script', hint: 'Cursive handwriting with joined letters.', group: 'handwritten', family: 'MarckScript', weights: [400], scripts: ['cyrillic'] },
  { id: 'badScript', label: 'Bad Script', hint: 'Flowing pen handwriting.', group: 'handwritten', family: 'BadScript', weights: [400], scripts: ['cyrillic'] },
  { id: 'caveat', label: 'Caveat', hint: 'A quick, casual pen.', group: 'handwritten', family: 'Caveat', weights: THREE, scripts: ['cyrillic'] },
  { id: 'mali', label: 'Mali', hint: 'Rounded, casual Thai handwriting.', group: 'handwritten', family: 'Mali', weights: THREE, scripts: ['thai'] },
  { id: 'sriracha', label: 'Sriracha', hint: 'Thai brush handwriting.', group: 'handwritten', family: 'Sriracha', weights: [400], scripts: ['thai'] },
  { id: 'yomogi', label: 'Yomogi', hint: 'Casual Japanese pen handwriting.', group: 'handwritten', family: 'Yomogi', weights: [400], scripts: ['japanese', 'cyrillic'], download: true },
  { id: 'zenKurenaido', label: 'Zen Kurenaido', hint: 'Neat Japanese handwriting, with Greek and Cyrillic.', group: 'handwritten', family: 'ZenKurenaido', weights: [400], scripts: ['japanese', 'cyrillic', 'greek'], download: true },
  { id: 'mitr', label: 'Mitr', hint: 'Bold, rounded Thai.', group: 'stylistic', family: 'Mitr', weights: THREE, scripts: ['thai'] },
  { id: 'charmonman', label: 'Charmonman', hint: 'Calligraphic Thai, formal and ornate.', group: 'stylistic', family: 'Charmonman', weights: [400, 700], scripts: ['thai'] },
  { id: 'zenMaru', label: 'Zen Maru Gothic', hint: 'Rounded Japanese, with Greek and Cyrillic.', group: 'stylistic', family: 'ZenMaruGothic', weights: [400], scripts: ['japanese', 'cyrillic', 'greek'], download: true },
];

/** The fonts a deck can cycle through: every one but the system font. */
export const CYCLE_FONTS: AppFont[] = APP_FONT_OPTIONS.filter((o) => o.id !== 'system').map((o) => o.id);

export const DEFAULT_APP_FONT: AppFont = 'system';

export function isAppFont(value: unknown): value is AppFont {
  return typeof value === 'string' && APP_FONT_OPTIONS.some((o) => o.id === value);
}

export function fontOption(id: AppFont): AppFontOption {
  return APP_FONT_OPTIONS.find((o) => o.id === id) ?? APP_FONT_OPTIONS[0];
}

/** Whether the font's files are in the app, so it can be used at once. A font that isn't is downloaded first. */
export function isBundled(id: AppFont): boolean {
  return !fontOption(id).download;
}

/** Whether a font covers every one of `scripts`. */
export function fontCovers(id: AppFont, scripts: readonly Script[]): boolean {
  const covered = fontOption(id).scripts;
  return scripts.every((s) => covered.includes(s));
}

/** The scripts of `scripts` a font doesn't cover. */
export function missingScripts(id: AppFont, scripts: readonly Script[]): Script[] {
  const covered = fontOption(id).scripts;
  return scripts.filter((s) => !covered.includes(s));
}

/** The fonts to cycle through in a deck with `scripts`: those that cover all of them. */
export function fontsCovering(scripts: readonly Script[]): AppFont[] {
  return CYCLE_FONTS.filter((id) => fontCovers(id, scripts));
}

/** What a font covers, for its row: "Latin, Cyrillic, Greek". The system font falls back by character, so it covers everything. */
export function coverageLine(id: AppFont): string {
  return id === 'system' ? 'Every script' : ['Latin', ...fontOption(id).scripts.map((s) => SCRIPT_NAMES[s])].join(', ');
}

/**
 * Snaps a `fontWeight` onto one of the three weights the app draws: a face that isn't bundled would draw in
 * the phone's font in the middle of a screen. Medium rounds down to regular, like anything lighter.
 */
export function normalizeFontWeight(weight: string | number | undefined | null): FontWeightKey {
  if (weight == null || weight === 'normal') return 400;
  if (weight === 'bold') return 700;
  const n = typeof weight === 'number' ? weight : parseInt(weight, 10);
  if (Number.isNaN(n) || n < 600) return 400;
  if (n < 700) return 600;
  return 700;
}

/** The bundled weight nearest the one asked for, the heavier of two that are equally near (emphasis stays emphasis). */
function bundledWeight(option: AppFontOption, weight: FontWeightKey): FontWeightKey {
  return option.weights.reduce((best, w) => {
    const dw = Math.abs(w - weight), db = Math.abs(best - weight);
    return dw < db || (dw === db && w > best) ? w : best;
  });
}

const FACE_SUFFIX: Record<FontWeightKey, string> = { 400: 'Regular', 600: 'SemiBold', 700: 'Bold' };
/** Each face's file name, `Nunito_600SemiBold.ttf`: the same as the files in assets/fonts. */
const FILE_SUFFIX: Record<FontWeightKey, string> = { 400: '400Regular', 600: '600SemiBold', 700: '700Bold' };

export const FONT_WEIGHTS: FontWeightKey[] = [400, 600, 700];

/**
 * The name iOS knows a face by, which is the file's PostScript name (`Nunito-SemiBold`), or undefined
 * for the system font. A family registered from static files has no heavier member to search for, so the
 * weight is picked here and the style's `fontWeight` is dropped. A family with fewer faces uses its nearest.
 */
export function resolveFontFace(id: AppFont, weight: string | number | undefined | null): string | undefined {
  const option = fontOption(id);
  return option.family ? `${option.family}-${FACE_SUFFIX[bundledWeight(option, normalizeFontWeight(weight))]}` : undefined;
}

/** The bundled file's name for a face, or undefined where the family has no face of that weight. */
export function fontFileName(id: AppFont, weight: FontWeightKey): string | undefined {
  const option = fontOption(id);
  return option.family && option.weights.includes(weight) ? `${option.family}_${FILE_SUFFIX[weight]}.ttf` : undefined;
}

/** Every file a font needs, for copying where a card page can read them. */
export function fontFileNames(id: AppFont): string[] {
  return FONT_WEIGHTS.map((w) => fontFileName(id, w)).filter((n): n is string => !!n);
}

/** The app-wide font choice, kept in the settings table as one JSON value. */
export interface FontSettings {
  font: AppFont;
  /** Pick one of `pool` each time the app opens, instead of using `font`. */
  random: boolean;
  /** The fonts a random pick comes from. Never empty. */
  pool: AppFont[];
  /** Card fronts and backs use the app's font too (a deck's own card fonts still win). */
  onCards: boolean;
}

export const DEFAULT_FONT_SETTINGS: FontSettings = { font: DEFAULT_APP_FONT, random: false, pool: [DEFAULT_APP_FONT], onCards: true };

/** Reads the stored value back, falling to the default for anything missing or no longer shipped. */
export function parseFontSettings(raw: string | null | undefined): FontSettings {
  if (!raw) return DEFAULT_FONT_SETTINGS;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return DEFAULT_FONT_SETTINGS; }
  if (!v || typeof v !== 'object') return DEFAULT_FONT_SETTINGS;
  const o = v as Record<string, unknown>;
  const font = isAppFont(o.font) ? o.font : DEFAULT_APP_FONT;
  const pool = Array.isArray(o.pool) ? [...new Set(o.pool.filter(isAppFont))] : [];
  return { font, random: o.random === true, pool: pool.length ? pool : [font], onCards: o.onCards !== false };
}

/** The font the app uses until it's next opened: `font`, or a pick from the pool when random is on. */
export function launchFont(s: FontSettings, random: () => number = Math.random): AppFont {
  if (!s.random || s.pool.length === 0) return s.font;
  return s.pool[Math.min(s.pool.length - 1, Math.floor(random() * s.pool.length))];
}

/** Adds or removes a font from the pool; the last one can't be removed, so a random pick always has something to pick. */
export function togglePoolFont(pool: AppFont[], id: AppFont): AppFont[] {
  if (!pool.includes(id)) return APP_FONT_OPTIONS.map((o) => o.id).filter((f) => f === id || pool.includes(f));
  return pool.length > 1 ? pool.filter((f) => f !== id) : pool;
}

/** How a deck's cards pick their font: the app's (no list), one fixed font, or a different one of several each session. */
export type DeckFontMode = 'app' | 'deck' | 'random';

/** The mode a saved `cardFonts` list means. One font is a fixed font; a list of several is a randomized one. */
export function deckFontMode(pool: readonly AppFont[]): DeckFontMode {
  return pool.length === 0 ? 'app' : pool.length === 1 ? 'deck' : 'random';
}

/**
 * The `cardFonts` list to save when a deck switches to `mode`, keeping what was chosen: the deck's first font
 * stays the fixed one, and a fixed font is the first one checked when randomizing. `covering` is the fonts
 * that can draw the deck, used when nothing was chosen yet (all of them to randomize, the first for one).
 */
export function poolForMode(mode: DeckFontMode, pool: readonly AppFont[], covering: readonly AppFont[]): AppFont[] {
  if (mode === 'app') return [];
  const from = pool.length ? pool : covering;
  return mode === 'deck' ? from.slice(0, 1) : [...from];
}

/**
 * The font a card shows in a deck that cycles. It comes from the card and the session, not from a draw
 * made as the card appears, so a card keeps one font across its front, its back and an undo, and gets
 * another the next session. `pool` is the deck's checked fonts; none means the deck doesn't cycle.
 */
export function cardFontFor(pool: readonly AppFont[], cardId: string, session: number): AppFont | undefined {
  if (pool.length === 0) return undefined;
  return pool[Number(fnvHash(`${cardId}:${session}`) % BigInt(pool.length))];
}
