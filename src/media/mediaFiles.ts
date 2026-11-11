import { Directory, File, Paths } from 'expo-file-system';

/**
 * Images and sounds from Anki, one file per name in the app's documents folder. Card pages load
 * them by relative path (`<img src="flag.svg">`) with this folder as the WebView's base URL.
 *
 * Names come from Anki, which never puts a "/" in one; a name that has one is refused rather than
 * written outside the folder.
 */

function folder(): Directory {
  const dir = new Directory(Paths.document, 'media');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** The folder as a file:// URI ending in "/", for a WebView's baseUrl and read access. */
export function mediaBaseUri(): string {
  const uri = folder().uri;
  return uri.endsWith('/') ? uri : `${uri}/`;
}

export async function writeMedia(name: string, bytes: Uint8Array): Promise<void> {
  if (name.includes('/') || name === '.' || name === '..') throw new Error(`Refused media file name "${name}"`);
  const file = new File(folder(), name);
  file.create({ overwrite: true });
  await file.write(bytes);
}

/** Every media file, for a backup. */
export function listMedia(): File[] {
  return folder().list().filter((e): e is File => e instanceof File);
}

/** Removes every media file, before a restore puts the backup's back. */
export function clearMedia(): void {
  for (const f of listMedia()) f.delete();
}

/** Moves a file into the media folder under `name`, replacing one already there. */
export async function moveIntoMedia(file: File, name: string): Promise<void> {
  if (name.includes('/') || name === '.' || name === '..') throw new Error(`Refused media file name "${name}"`);
  const target = new File(folder(), name);
  if (target.exists) target.delete();
  await file.move(target);
}

/** Whether a media file is here. */
export function hasMedia(name: string): boolean {
  return !name.includes('/') && new File(folder(), name).exists;
}

/** Removes one media file, if it's here. */
export function removeMedia(name: string): void {
  if (name.includes('/')) return;
  const f = new File(folder(), name);
  if (f.exists) f.delete();
}

/** A media file's file:// URI, or undefined when it isn't here (a package exported without media). */
export function mediaFileUri(name: string): string | undefined {
  if (name.includes('/')) return undefined;
  const f = new File(folder(), name);
  return f.exists ? f.uri : undefined;
}
