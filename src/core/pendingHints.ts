/**
 * Leeches made during a review session, waiting for a hint. The answer that makes a card a leech
 * tags its note straight away, but asking for the hint waits for the session's summary, so a leech
 * doesn't stop the review. Pure so the list's rules are tested (tests/core/pendingHints.test.ts).
 */
export type PendingHint = {
  noteId: string;
  /** The card whose answer made the leech, so undoing that answer takes it back off the list. */
  cardId: string;
  misses: number;
  /** The card that answer suspended, which saving a hint brings back. */
  suspendedCardId?: string;
};

/** Adds a leech. A note already waiting (its other card became a leech too) keeps its place, takes the newer miss count, and keeps a suspended card it had. */
export function addPendingHint(list: PendingHint[], hint: PendingHint): PendingHint[] {
  const at = list.findIndex((h) => h.noteId === hint.noteId);
  if (at < 0) return [...list, hint];
  const suspendedCardId = hint.suspendedCardId ?? list[at].suspendedCardId;
  return list.map((h, i) => (i === at ? { ...hint, ...(suspendedCardId ? { suspendedCardId } : {}) } : h));
}

/** Takes a leech back off the list when the answer that made it is undone. */
export function removePendingHintForCard(list: PendingHint[], cardId: string): PendingHint[] {
  return list.some((h) => h.cardId === cardId) ? list.filter((h) => h.cardId !== cardId) : list;
}

/** Takes a note off the list once its hint is saved or skipped. */
export function removePendingHint(list: PendingHint[], noteId: string): PendingHint[] {
  return list.some((h) => h.noteId === noteId) ? list.filter((h) => h.noteId !== noteId) : list;
}
