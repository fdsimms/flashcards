import { useEffect, useRef } from 'react';
import { deckListTotals, type DeckRow } from '../core/deckTree';
import { studyDayKey } from '../core/day';
import { shouldReport, type SentCounts } from '../reader/countsReport';
import type { ReaderState } from './useReader';

/**
 * Sends the deck list's totals to Read & Listen's server whenever they change (and once each study
 * day), while Read & Listen is on and its "Share today's counts" setting is. dundundun's Franki task
 * reads them from the server's /api/status. The deck list is recounted after every sync and study
 * session, so this follows it rather than counting again (src/reader/countsReport.ts).
 */
export function useCountsReport(reader: ReaderState, decks: DeckRow[], dayStartsAtHour: number): void {
  const sent = useRef<SentCounts | null>(null);
  const { api, shareCounts } = reader;
  useEffect(() => {
    if (!api || !shareCounts || decks.length === 0) return;
    // The same totals the deck list's own header shows.
    const totals = deckListTotals(decks);
    const counts = { due: totals.due, new: totals.fresh };
    const dayKey = studyDayKey(new Date(), dayStartsAtHour);
    if (!shouldReport(sent.current, counts, dayKey)) return;
    // Recorded before the await, so a second recount while this is in flight doesn't send twice;
    // a failed send is forgotten, so the next recount tries again.
    const sending = { ...counts, dayKey };
    sent.current = sending;
    api.reportCounts(counts).catch(() => {
      if (sent.current === sending) sent.current = null;
    });
  }, [api, shareCounts, decks, dayStartsAtHour]);
}
