import { useEffect, useRef } from 'react';
import { cramsReport } from '../core/cramsReport';
import type { NoteStore } from '../anki/noteService';
import { useCrams } from './useCrams';
import type { ReaderState } from './useReader';

/**
 * Sends the open crams to Read & Listen's server whenever they change, while Read & Listen is on and
 * its "Share today's counts and crams" setting is. dundundun's cram tasks read them from the
 * server's /api/status (src/core/cramsReport.ts). The crams are read again on every deck-list
 * refresh (`useCramCap`), so a send that failed is tried again then. Turning the setting off sends
 * an empty list once, so dundundun takes its cram tasks away rather than keep the last ones, and
 * so does signing out of Read & Listen (`signOut` in useReader).
 */
export function useCramsReport(reader: ReaderState, repo: NoteStore | null, dayStartsAtHour: number): void {
  const { crams, loaded } = useCrams(repo);
  const sent = useRef<string | null>(null);
  const wasSharing = useRef(false);
  const { api, shareCounts } = reader;
  useEffect(() => {
    if (!api) return;
    if (!shareCounts) {
      // Only on the switch going off here, so nothing is sent while it stays off.
      if (wasSharing.current) {
        wasSharing.current = false;
        sent.current = null;
        api.reportCrams([]).catch(() => undefined);
      }
      return;
    }
    wasSharing.current = true;
    // Until the first read lands, an empty list would take every task away.
    if (!loaded) return;
    const report = cramsReport(crams, new Date(), dayStartsAtHour);
    const body = JSON.stringify(report);
    if (body === sent.current) return;
    // Recorded before the await, so a second change while this is in flight doesn't send twice;
    // a failed send is forgotten, so the next change or refresh tries again.
    sent.current = body;
    api.reportCrams(report).catch(() => {
      if (sent.current === body) sent.current = null;
    });
  }, [api, shareCounts, crams, loaded, dayStartsAtHour]);
}
