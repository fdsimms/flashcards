import { describe, expect, it } from 'vitest';
import { decodeDeckSnapshot, encodeDeckSnapshot } from '../../src/core/deckSnapshot';
import type { DeckRow } from '../../src/core/deckTree';

const rows: DeckRow[] = [
  { deck: 'Thai', name: 'Thai', depth: 0, due: 12, fresh: 5, total: 300, unstudied: 40 },
  { deck: 'Thai::Verbs', name: 'Verbs', depth: 1, due: 4, fresh: 2, total: 80, unstudied: 10, gate: { inProgress: 3, cap: 10 } },
];

describe('deck list snapshot', () => {
  it('round-trips within the same study day', () => {
    const raw = encodeDeckSnapshot(rows, new Set(['Thai']), new Date(2026, 10, 12, 20), 4);
    expect(decodeDeckSnapshot(raw, new Date(2026, 10, 13, 1))).toEqual({ decks: rows, collapsed: new Set(['Thai']) });
  });
  it('is dropped once the next study day has started', () => {
    const raw = encodeDeckSnapshot(rows, new Set(['Thai']), new Date(2026, 10, 12, 20), 4);
    expect(decodeDeckSnapshot(raw, new Date(2026, 10, 13, 4, 0))).toBeNull();
  });
  it('reads a snapshot saved without collapsed decks as none collapsed', () => {
    const raw = JSON.stringify({ dayKey: '2026-11-12', hour: 4, decks: rows });
    expect(decodeDeckSnapshot(raw, new Date(2026, 10, 12, 12))?.collapsed).toEqual(new Set());
  });
  it('is dropped when unreadable, empty or shaped wrong', () => {
    const now = new Date(2026, 10, 12, 12);
    expect(decodeDeckSnapshot(null, now)).toBeNull();
    expect(decodeDeckSnapshot('not json', now)).toBeNull();
    expect(decodeDeckSnapshot(encodeDeckSnapshot([], new Set(), now, 4), now)).toBeNull();
    expect(decodeDeckSnapshot(JSON.stringify({ dayKey: '2026-11-12', hour: 4, decks: [{ deck: 'A' }] }), now)).toBeNull();
  });
});
