import * as Font from 'expo-font';
import { Directory, File, Paths } from 'expo-file-system';
import { DOWNLOADED_FONTS_DIR, DOWNLOADABLE_FONTS, FONT_DOWNLOADS } from '../core/fontDownloads';
import { Refusal } from '../core/failure';
import { fontOption, resolveFontFace, FONT_WEIGHTS, fontFileName, type AppFont } from '../core/fonts';
import { connection } from './connection';

/**
 * The phone's side of downloaded fonts (src/core/fontDownloads.ts): files in the documents folder, which
 * card pages can read, registered with iOS under their PostScript names so `fontFamily` finds them.
 */

/** How long a download may go without receiving anything before it's given up. */
const STALLED_MS = 15_000;

const folder = () => new Directory(Paths.document, DOWNLOADED_FONTS_DIR);

/** The folder's file:// URI with a trailing slash, for `cardDocument`'s `font.base`. */
export function downloadedFontsBase(): string {
  const uri = folder().uri;
  return uri.endsWith('/') ? uri : `${uri}/`;
}

/** Whether all of a font's files are on the phone at their full size. */
function complete(id: AppFont): boolean {
  const files = FONT_DOWNLOADS[id] ?? [];
  return files.length > 0 && files.every((f) => {
    const file = new File(folder(), f.name);
    return file.exists && file.size === f.bytes;
  });
}

/** The downloaded fonts that are on the phone. */
export function installedFonts(): AppFont[] {
  try {
    return DOWNLOADABLE_FONTS.filter(complete);
  } catch {
    return []; // no folder yet
  }
}

/** The PostScript name each face of a font is registered under, with its file. */
function faces(id: AppFont): Record<string, string> {
  const out: Record<string, string> = {};
  for (const w of FONT_WEIGHTS) {
    const name = fontFileName(id, w);
    const face = resolveFontFace(id, w);
    if (name && face && fontOption(id).weights.includes(w)) out[face] = new File(folder(), name).uri;
  }
  return out;
}

/** Registers a font's files with iOS. A family already registered is left as it is, so this is safe to repeat. */
export async function registerFont(id: AppFont): Promise<void> {
  await Font.loadAsync(faces(id));
}

/**
 * Downloads a font's files and registers them. `onProgress` gets 0 to 1 across all of them. Each file is
 * given up when nothing arrives for STALLED_MS (a dead network on a platform), and a file of the wrong size is
 * thrown away, so a half-written font never passes for one.
 */
export async function downloadFont(id: AppFont, onProgress: (done: number) => void, signal?: AbortSignal): Promise<void> {
  const files = FONT_DOWNLOADS[id];
  if (!files) throw new Error(`${id} has no download`);
  if (connection.get().path === 'none') throw new Refusal("Can't download the font while offline. Connect to the internet and try again.");
  const dir = folder();
  dir.create({ idempotent: true, intermediates: true });
  const total = files.reduce((sum, f) => sum + f.bytes, 0);
  let finished = 0;
  for (const f of files) {
    const target = new File(dir, f.name);
    if (target.exists && target.size === f.bytes) { finished += f.bytes; onProgress(finished / total); continue; }
    const part = new File(dir, `${f.name}.part`);
    const abort = new AbortController();
    signal?.addEventListener('abort', () => abort.abort());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => abort.abort(), STALLED_MS); };
    idle();
    try {
      await File.downloadFileAsync(f.url, part, {
        idempotent: true,
        signal: abort.signal,
        onProgress: (p) => { idle(); onProgress((finished + p.bytesWritten) / total); },
      });
      if (part.size !== f.bytes) throw new Refusal("The font didn't download completely. Try again.");
      await part.move(target, { overwrite: true });
    } catch (e) {
      try { if (part.exists) part.delete(); } catch { /* already gone */ }
      if (signal?.aborted) throw e;
      if (abort.signal.aborted) throw new Refusal("The download stopped. Check your connection and try again.");
      throw e;
    } finally {
      clearTimeout(timer);
    }
    finished += f.bytes;
    onProgress(finished / total);
  }
  await registerFont(id);
}

/** Deletes a font's files. It stays registered until the app restarts, which only matters to what's drawn in it, and nothing is once it's unavailable. */
export function removeFont(id: AppFont): void {
  for (const f of FONT_DOWNLOADS[id] ?? []) {
    const file = new File(folder(), f.name);
    if (file.exists) file.delete();
  }
}
