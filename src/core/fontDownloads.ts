// The fonts that aren't in the app: where each one's files are downloaded from, and which fonts can be used.
// Pure, so it's tested; src/ui/fontDownloads.ts does the downloading.
import { APP_FONT_OPTIONS, fontCovers, isBundled, languageScripts, type AppFont } from './fonts';

/** Where downloaded font files go in the documents folder, which card pages can read. Bump it to download them again. */
export const DOWNLOADED_FONTS_DIR = 'downloaded-fonts-1';

export interface FontFile {
  /** The file's name, as in assets/fonts (`Yomogi_400Regular.ttf`). */
  name: string;
  url: string;
  /** Its exact size: a download of any other size is thrown away. */
  bytes: number;
}

/**
 * The @expo-google-fonts package each file comes from, at the exact version, on jsDelivr. These are the
 * same OFL files the bundled fonts are made of, and a version's files never change.
 */
const cdn = (pkg: string, version: string, file: string, bytes: number): FontFile => ({
  name: file,
  url: `https://cdn.jsdelivr.net/npm/@expo-google-fonts/${pkg}@${version}/${file.replace(/^[A-Za-z0-9]+_/, '').replace(/\.ttf$/, '')}/${file}`,
  bytes,
});

/** Every font marked `download` has its files here (tests/core/fontDownloads.test.ts). */
export const FONT_DOWNLOADS: Partial<Record<AppFont, FontFile[]>> = {
  yomogi: [cdn('yomogi', '0.4.2', 'Yomogi_400Regular.ttf', 4044704)],
  zenKurenaido: [cdn('zen-kurenaido', '0.4.2', 'ZenKurenaido_400Regular.ttf', 4303064)],
  zenMaru: [cdn('zen-maru-gothic', '0.4.2', 'ZenMaruGothic_400Regular.ttf', 3832732)],
};

/** The size of a font's download, for its row. */
export function downloadBytes(id: AppFont): number {
  return (FONT_DOWNLOADS[id] ?? []).reduce((sum, f) => sum + f.bytes, 0);
}

/** "3.9 MB": megabytes to one place, as iOS counts them. */
export function sizeText(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Whether a font can be used now: it's in the app, or its download is on the phone. */
export function isAvailable(id: AppFont, installed: ReadonlySet<AppFont>): boolean {
  return isBundled(id) || installed.has(id);
}

/** The font to draw in: `id`, or the system font when its files aren't on the phone (a font removed, or a backup restored on a new one). */
export function availableFont(id: AppFont, installed: ReadonlySet<AppFont>): AppFont {
  return isAvailable(id, installed) ? id : 'system';
}

/** The fonts of `ids` that can be used now. */
export function availableFonts(ids: readonly AppFont[], installed: ReadonlySet<AppFont>): AppFont[] {
  return ids.filter((id) => isAvailable(id, installed));
}

/**
 * The fonts a language's Text menu offers: those that can draw its script and are on the phone now, the
 * system font first. A font that can't draw the language, or isn't downloaded, is left out (Settings,
 * Font lists those with the reason).
 */
export function languageFontChoices(code: string | null | undefined, installed: ReadonlySet<AppFont>): AppFont[] {
  const scripts = languageScripts(code);
  return APP_FONT_OPTIONS.map((o) => o.id).filter((id) => fontCovers(id, scripts) && isAvailable(id, installed));
}

/** Every font that's downloaded rather than bundled, in list order. */
export const DOWNLOADABLE_FONTS: AppFont[] = APP_FONT_OPTIONS.filter((o) => o.download).map((o) => o.id);
