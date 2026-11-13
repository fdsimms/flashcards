import { studyDayKey } from './day';
import type { DeckRow } from './deckTree';

/**
 * The deck list as it was last loaded, kept so a cold start can show it while the real load (which
 * waits on a sync holding the collection) and the sync run. Counts depend on the study day, so a
 * snapshot from an earlier day is dropped rather than shown with yesterday's numbers.
 */
interface Snapshot { dayKey: string; hour: number; decks: DeckRow[] }

export function encodeDeckSnapshot(decks: DeckRow[], now: Date, dayStartsAtHour: number): string {
  const snapshot: Snapshot = { dayKey: studyDayKey(now, dayStartsAtHour), hour: dayStartsAtHour, decks };
  return JSON.stringify(snapshot);
}

const isRow = (r: unknown): r is DeckRow => {
  const x = r as Partial<DeckRow> | null;
  return !!x && typeof x.deck === 'string' && typeof x.name === 'string' && typeof x.depth === 'number'
    && typeof x.due === 'number' && typeof x.fresh === 'number' && typeof x.total === 'number';
};

/** The saved rows, or null when there are none, they can't be read, or they're from an earlier study day. */
export function decodeDeckSnapshot(raw: string | null, now: Date): DeckRow[] | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<Snapshot> | null;
    if (!s || typeof s.dayKey !== 'string' || typeof s.hour !== 'number' || !Array.isArray(s.decks)) return null;
    if (s.dayKey !== studyDayKey(now, s.hour)) return null;
    if (!s.decks.length || !s.decks.every(isRow)) return null;
    return s.decks;
  } catch {
    return null;
  }
}
