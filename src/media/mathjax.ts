import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { MATHJAX_DIR, MATHJAX_FILE } from '../core/mathjax';

/**
 * The bundled MathJax (src/core/mathjax.ts) where card pages can load it: the documents folder,
 * which the WebView may read, unlike the app bundle the asset ships in. Copied there the first
 * time a card with math is shown.
 */

function target(): File {
  return new File(Paths.document, MATHJAX_DIR, MATHJAX_FILE);
}

/** The script's file:// URI, for `cardDocument`'s `mathjax`. */
export function mathjaxUri(): string {
  return target().uri;
}

let installing: Promise<void> | undefined;

/** Puts the script in place if it isn't there yet. Safe to call for every page. */
export function installMathJax(): Promise<void> {
  installing ??= copyMathJax().catch((e) => { installing = undefined; throw e; });
  return installing;
}

async function copyMathJax(): Promise<void> {
  const dest = target();
  if (dest.exists) return;
  const [asset] = await Asset.loadAsync(require('../../assets/mathjax/tex-svg-full.txt'));
  if (!asset.localUri) throw new Error('The MathJax asset has no local file');
  const dir = new Directory(Paths.document, MATHJAX_DIR);
  dir.create({ idempotent: true, intermediates: true });
  // Copied under another name and then renamed, so a copy cut short never passes for the script.
  const part = new File(dir, `${MATHJAX_FILE}.part`);
  await new File(asset.localUri).copy(part, { overwrite: true });
  await part.move(dest);
  // An earlier version's folder is no longer loaded by any page.
  for (const entry of Paths.document.list()) {
    if (entry instanceof Directory && entry.name.startsWith('mathjax-') && entry.name !== MATHJAX_DIR) entry.delete();
  }
}
