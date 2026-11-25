import { useEffect } from 'react';
import { parseWrittenPoints, setWrittenPoints } from '../core/grammar';
import type { Api } from '../reader/api';
import { loadWrittenPointsCopy, saveWrittenPointsCopy } from '../reader/storage';

/**
 * Puts the grammar points Claude wrote (Read & Listen's server, written_points.py) beside the
 * bundled catalog, so their pages, lessons and drills open: the phone's copy at launch, then the
 * server's list whenever Read & Listen is reached, kept as the next copy.
 */
export function useWrittenPoints(api: Api | null): void {
  useEffect(() => {
    void loadWrittenPointsCopy().then((raw) => setWrittenPoints(parseWrittenPoints(raw)));
  }, []);
  useEffect(() => {
    if (!api) return;
    api.writtenPoints().then((r) => {
      setWrittenPoints(parseWrittenPoints(r.points));
      saveWrittenPointsCopy(r.points);
    }, () => undefined);
  }, [api]);
}
