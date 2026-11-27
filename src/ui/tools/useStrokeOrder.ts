import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { hasStrokeFile, parseStrokes, strokeFileName, strokeUrl, type StrokeOrder } from '../../tools/strokeOrder';
import { guardedFetch } from '../connection';

/**
 * A character's stroke order (src/tools/strokeOrder.ts), for Writing by hand: read from the copy
 * in the caches folder, else downloaded from jsDelivr through the connection guard and kept
 * there. The caches folder, since a file iOS clears is only downloaded again, and nothing in it
 * belongs in a backup. A character with no file, or one that can't be reached, has none, and the
 * tool shows it in the font as it would with the setting off.
 */

/** Bump it to download the files again (a new KanjiVG release). */
const FOLDER = 'stroke-order-1';

/** Read this run: a character asked for again (Trace it, then its answer) is neither read nor downloaded twice. */
const held = new Map<string, Promise<StrokeOrder | null>>();
let fetcher: typeof fetch | undefined;

async function read(character: string): Promise<StrokeOrder | null> {
  const dir = new Directory(Paths.cache, FOLDER);
  const file = new File(dir, strokeFileName(character));
  try {
    const kept = file.exists ? parseStrokes(await file.text()) : null;
    if (kept) return kept;
  } catch {
    // An unreadable copy is downloaded again.
  }
  fetcher ??= guardedFetch('https://cdn.jsdelivr.net');
  const response = await fetcher(strokeUrl(character));
  // KanjiVG has no file for it: nothing to draw, now or on a later try.
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status}`);
  const svg = await response.text();
  const order = parseStrokes(svg);
  if (order) {
    try {
      dir.create({ idempotent: true, intermediates: true });
      if (!file.exists) file.create();
      file.write(svg);
    } catch {
      // Not kept: it's downloaded again next time.
    }
  }
  return order;
}

function load(character: string): Promise<StrokeOrder | null> {
  let loading = held.get(character);
  if (!loading) {
    // A download that failed (offline, the server out of reach) isn't held, so the next question tries again.
    loading = read(character).catch(() => { held.delete(character); return null; });
    held.set(character, loading);
  }
  return loading;
}

/** `text`'s strokes while `on` and it's one kana or kanji; none until they're read, and when there are none to show. */
export function useStrokeOrder(text: string | undefined, on: boolean): StrokeOrder | null {
  const wanted = on && text && hasStrokeFile(text) ? text : undefined;
  const [got, setGot] = useState<{ text: string; order: StrokeOrder | null } | null>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    // The question may have moved on by the time the file arrives.
    let current = true;
    load(wanted).then((order) => { if (current) setGot({ text: wanted, order }); });
    return () => { current = false; };
  }, [wanted]);
  return wanted && got?.text === wanted ? got.order : null;
}
