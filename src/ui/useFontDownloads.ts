import { useCallback, useEffect, useState } from 'react';
import type { AppFont } from '../core/fonts';
import { downloadFont, installedFonts, registerFont, removeFont } from './fontDownloads';

export interface FontDownloads {
  /** The fonts on the phone are registered, so what's drawn can start in the right font. */
  ready: boolean;
  /** The downloaded fonts that can be used now. */
  installed: ReadonlySet<AppFont>;
  /** How far each font being downloaded is, 0 to 1. */
  progress: ReadonlyMap<AppFont, number>;
  /** Downloads a font and makes it usable. Rejects when it can't, for the screen to say. */
  download: (id: AppFont) => Promise<void>;
  /** Deletes a font's files. */
  remove: (id: AppFont) => void;
}

/** The downloaded fonts: registers those on the phone at launch, and downloads and removes them (src/core/fontDownloads.ts). */
export function useFontDownloads(): FontDownloads {
  const [installed, setInstalled] = useState<ReadonlySet<AppFont>>(new Set());
  const [progress, setProgress] = useState<ReadonlyMap<AppFont, number>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stale = false;
    (async () => {
      const usable: AppFont[] = [];
      for (const id of installedFonts()) {
        try { await registerFont(id); usable.push(id); } catch (e) { console.warn(`Font ${id} not registered`, e); }
      }
      if (!stale) { setInstalled(new Set(usable)); setReady(true); }
    })();
    return () => { stale = true; };
  }, []);

  const download = useCallback(async (id: AppFont) => {
    setProgress((prev) => (prev.has(id) ? prev : new Map(prev).set(id, 0)));
    try {
      await downloadFont(id, (done) => setProgress((prev) => new Map(prev).set(id, done)));
      setInstalled((prev) => new Set(prev).add(id));
    } finally {
      setProgress((prev) => { const next = new Map(prev); next.delete(id); return next; });
    }
  }, []);

  const remove = useCallback((id: AppFont) => {
    removeFont(id);
    setInstalled((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  return { ready, installed, progress, download, remove };
}
