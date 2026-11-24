import { describe, expect, it } from 'vitest';
import { deckAndParents, studiedDelta, studiedOn, withStudied } from '../../src/anki/deckStats';
import { decodeMessage, int, MessageWriter, uint } from '../../src/anki/protobuf';

const common = (fields: Record<number, number>, collapsed = false) => {
  const w = new MessageWriter();
  if (collapsed) w.uint(1, 1);
  for (const [n, v] of Object.entries(fields)) w.uint(Number(n), v);
  w.bytes(255, new Uint8Array([123, 125])); // Common.other: "{}"
  return w.finish();
};
const counts = (bytes: Uint8Array) => {
  const m = decodeMessage(bytes);
  return { day: uint(m, 3) ?? 0, new: int(m, 4) ?? 0, review: int(m, 5) ?? 0, learning: int(m, 6) ?? 0, ms: int(m, 7) ?? 0, collapsed: uint(m, 1) === 1, other: m.has(255) };
};

describe("a deck's studied-today counts", () => {
  it('counts an answer from the queue the card was in, as Anki does', () => {
    expect(studiedDelta({ type: 0, queue: 0, due: 5 }, 4000)).toEqual({ new: 1, review: 0, ms: 4000 });
    expect(studiedDelta({ type: 2, queue: 2, due: 900 }, 3000)).toEqual({ new: 0, review: 1, ms: 3000 });
    expect(studiedDelta({ type: 1, queue: 3, due: 900 }, 3000)).toEqual({ new: 0, review: 1, ms: 3000 });
    expect(studiedDelta({ type: 1, queue: 1, due: 1_800_000_000 }, 2000)).toEqual({ new: 0, review: 0, ms: 2000 });
  });

  it('counts a card still buried from an earlier day by its type, as Anki has unburied it by then', () => {
    // Sibling-buried (-2) and buried by hand (-3) new cards are new cards studied.
    expect(studiedDelta({ type: 0, queue: -2, due: 5 }, 4000)).toEqual({ new: 1, review: 0, ms: 4000 });
    expect(studiedDelta({ type: 0, queue: -3, due: 5 }, 4000)).toEqual({ new: 1, review: 0, ms: 4000 });
    expect(studiedDelta({ type: 2, queue: -2, due: 900 }, 3000)).toEqual({ new: 0, review: 1, ms: 3000 });
    // A learning card on a day-long step is a review; one on a step within the day counts nothing.
    expect(studiedDelta({ type: 3, queue: -2, due: 900 }, 3000)).toEqual({ new: 0, review: 1, ms: 3000 });
    expect(studiedDelta({ type: 1, queue: -3, due: 1_800_000_000 }, 2000)).toEqual({ new: 0, review: 0, ms: 2000 });
  });

  it("adds to today's counts, keeping every other field", () => {
    const after = withStudied(common({ 3: 100, 4: 5, 5: 7, 6: 1, 7: 60000 }, true), 100, { new: 1, review: 0, ms: 4000 });
    expect(counts(after)).toEqual({ day: 100, new: 6, review: 7, learning: 1, ms: 64000, collapsed: true, other: true });
  });

  it("starts from nothing on a new day, and keeps a count below zero that extended limits left", () => {
    expect(counts(withStudied(common({ 3: 99, 4: 5, 5: 7, 6: 1, 7: 60000 }), 100, { new: 0, review: 1, ms: 2000 })))
      .toMatchObject({ day: 100, new: 0, review: 1, learning: 0, ms: 2000 });
    expect(counts(withStudied(common({ 3: 100, 4: -10 }), 100, { new: 1, review: 0, ms: 0 })).new).toBe(-9);
  });

  it('finds the deck and every deck above it, whatever the case of their names', () => {
    const row = (id: number, name: string) => ({ id, name, mtime_secs: 0, usn: 0, common: new Uint8Array() });
    const decks = [row(1, 'Polski'), row(2, 'polski\x1fOdmiana'), row(3, 'Polski\x1fOdmiana\x1fRzeczowniki'), row(4, 'Polski2'), row(5, 'Default')];
    expect(deckAndParents(decks, 3).map((d) => d.id)).toEqual([3, 1, 2]);
    expect(deckAndParents(decks, 1).map((d) => d.id)).toEqual([1]);
    expect(deckAndParents(decks, 9)).toEqual([]);
  });
});

describe('studiedOn', () => {
  it("reads a deck's counts for the day, and none from an earlier one", () => {
    const common = withStudied(new Uint8Array(), 100, { new: 2, review: 5, ms: 1000 });
    expect(studiedOn(common, 100)).toEqual({ new: 2, review: 5 });
    expect(studiedOn(common, 101)).toEqual({ new: 0, review: 0 });
    expect(studiedOn(new Uint8Array(), 100)).toEqual({ new: 0, review: 0 });
  });
});
