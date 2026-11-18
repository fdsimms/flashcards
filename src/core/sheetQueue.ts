/**
 * Review's sheets, one at a time. iOS presents one modal at a time and ignores a request made
 * while another is still presenting or dismissing, and React never asks again, so a second sheet
 * (the confused-word link raised by the same answer as a leech's hint, say) used to be lost until
 * something remounted it. Here the head of the queue is the only one shown. When it closes it is
 * hidden but kept mounted (`leaving`) until iOS reports it gone, and only then does the next one
 * mount. Pure so the order is tested (tests/core/sheetQueue.test.ts).
 */
export type SheetQueue<S extends { key: string }> = {
  items: S[];
  /** The head has been closed and is waiting for iOS to finish dismissing it. */
  leaving: boolean;
};

export function emptyQueue<S extends { key: string }>(): SheetQueue<S> {
  return { items: [], leaving: false };
}

/** Adds a sheet at the back. One already waiting (or showing) under the same key is updated in place instead; a head that is leaving doesn't count, since it is going. */
export function request<S extends { key: string }>(q: SheetQueue<S>, sheet: S): SheetQueue<S> {
  const at = q.items.findIndex((s, i) => s.key === sheet.key && !(i === 0 && q.leaving));
  if (at < 0) return { ...q, items: [...q.items, sheet] };
  return { ...q, items: q.items.map((s, i) => (i === at ? sheet : s)) };
}

/** Closes a sheet: the head is hidden to be dismissed, one still waiting is just dropped. */
export function close<S extends { key: string }>(q: SheetQueue<S>, key: string): SheetQueue<S> {
  if (q.items[0]?.key === key) return q.leaving ? q : { ...q, leaving: true };
  return { ...q, items: q.items.filter((s, i) => i === 0 || s.key !== key) };
}

/** iOS has finished dismissing the head (or gave up on it): the next sheet may mount. */
export function dismissed<S extends { key: string }>(q: SheetQueue<S>, key: string): SheetQueue<S> {
  if (!q.leaving || q.items[0]?.key !== key) return q;
  return { items: q.items.slice(1), leaving: false };
}
