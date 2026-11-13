import { decodeMessage, int, MessageWriter, uint } from './protobuf';

/**
 * A deck's "studied today" counts (`Deck.Common`), which Anki's daily limits read rather than the
 * review log: an answer adds to them on the deck the card is studied in and every deck above it,
 * as rslib's `update_deck_stats_from_answer` does (decks/stats.rs, scheduler/answering/mod.rs in
 * ankitects/anki). Without them, a deck studied here had its whole limit left in Anki that day.
 * Field numbers from proto/anki/decks.proto.
 */

const COMMON = { lastDayStudied: 3, newStudied: 4, reviewStudied: 5, learningStudied: 6, msStudied: 7 };
const COUNTS = new Set(Object.values(COMMON));

/** A deck row as the kept collection has it: the parts an answer changes. */
export interface DeckStatsRow { id: number; name: string; mtime_secs: number; usn: number; common: Uint8Array }

/** What one answer adds: Anki counts a card answered from the new queue as new, from the review or day-learning queue as a review. */
export interface StudiedDelta { new: number; review: number; ms: number }

export function studiedDelta(queueBefore: number, takenMs: number): StudiedDelta {
  return { new: queueBefore === 0 ? 1 : 0, review: queueBefore === 2 || queueBefore === 3 ? 1 : 0, ms: takenMs };
}

/**
 * `Deck.Common` with `delta` added to today's counts, every other field kept: counts from an earlier
 * day are cleared first (`reset_stats_if_day_changed`). Zeros are left out, as protobuf does.
 */
export function withStudied(common: Uint8Array, today: number, delta: StudiedDelta): Uint8Array {
  const msg = decodeMessage(common);
  const sameDay = (uint(msg, COMMON.lastDayStudied) ?? 0) === today;
  const count = (n: number) => (sameDay ? int(msg, n) ?? 0 : 0);
  const w = new MessageWriter();
  for (const [n, fields] of msg) {
    if (COUNTS.has(n)) continue;
    for (const f of fields) {
      if (f.wire === 0) w.uint(n, f.value);
      else if (f.wire === 2) w.bytes(n, f.value);
      else w.fixed(n, f.wire, f.value);
    }
  }
  const put = (n: number, v: number) => { if (v !== 0) w.uint(n, v); };
  put(COMMON.lastDayStudied, today);
  put(COMMON.newStudied, count(COMMON.newStudied) + delta.new);
  put(COMMON.reviewStudied, count(COMMON.reviewStudied) + delta.review);
  put(COMMON.learningStudied, count(COMMON.learningStudied));
  put(COMMON.msStudied, count(COMMON.msStudied) + delta.ms);
  return w.finish();
}

/** The deck `did` and each deck above it, by name (levels joined by \x1f; Anki's names ignore case). */
export function deckAndParents(decks: DeckStatsRow[], did: number): DeckStatsRow[] {
  const deck = decks.find((d) => d.id === did);
  if (!deck) return [];
  const levels = deck.name.split('\x1f');
  const parents = levels.slice(1).map((_, i) => levels.slice(0, i + 1).join('\x1f').toLowerCase());
  return [deck, ...decks.filter((d) => d.id !== did && parents.includes(d.name.toLowerCase()))];
}
