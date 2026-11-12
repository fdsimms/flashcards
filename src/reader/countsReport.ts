// What Franki tells its server for dundundun: the deck list's totals (deckListTotals), so
// dundundun's "Franki: 42 cards left" task counts new cards the way Franki does, progress gates
// included, which Anki's own count on the server can't. Sent while Read & Listen is on and its
// "Share today's counts" setting is (prefs.ts), from useCountsReport. Pure, so it's tested.

export interface Counts {
  due: number;
  new: number;
}

/** What was last sent, and on which study day. */
export interface SentCounts extends Counts {
  dayKey: string;
}

/**
 * Whether to send `counts` now: when they differ from what was last sent, or nothing was sent yet
 * this study day (the server shows only a report made since the day began, so an unchanged count
 * still has to be sent again once a day).
 */
export function shouldReport(last: SentCounts | null, counts: Counts, dayKey: string): boolean {
  if (!last || last.dayKey !== dayKey) return true;
  return last.due !== counts.due || last.new !== counts.new;
}
