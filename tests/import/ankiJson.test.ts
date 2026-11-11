import { describe, expect, it } from 'vitest';
import { importAnkiJson } from '../../src/import/ankiJson';
import { omnilanguageFieldNames } from '../../src/import/models';
import { NOW } from '../support/fixtures';

describe('Anki JSON import', () => {
  const created = Math.floor(new Date(2025, 0, 1, 4).getTime() / 1000);
  const noteInfo = (id: number, over: Record<string, string> = {}) => ({
    noteId: id,
    modelName: 'Omnilanguage',
    tags: ['verb'],
    fields: Object.fromEntries(
      omnilanguageFieldNames.map((n, i) => [n, { value: ({ Entry: 'gehen', Meaning: 'to go', GenerateReverse: 'y', ...over } as Record<string, string>)[n] ?? '', order: i }]),
    ),
  });

  it('carries over interval, ease, due date and suspension', () => {
    const res = importAnkiJson({
      collectionCreated: created,
      notes: [noteInfo(1)],
      cards: [
        { cardId: 10, note: 1, deckName: 'Deutsch', ord: 0, type: 2, queue: 2, due: 400, interval: 30, factor: 2500, reps: 8, lapses: 1 },
        { cardId: 11, note: 1, deckName: 'Deutsch', ord: 1, type: 0, queue: -1 },
      ],
    }, { now: NOW });
    const fwd = res.cards.find((c) => c.kind === 'forward')!;
    const rev = res.cards.find((c) => c.kind === 'reverse')!;
    expect(fwd.sched.state).toBe(2);
    expect(fwd.sched.stability).toBe(30);
    expect(fwd.sched.difficulty).toBe(5);
    expect(fwd.sched.lapses).toBe(1);
    expect(fwd.sched.due).toBe(new Date((created + 400 * 86400) * 1000).toISOString());
    expect(rev.suspended).toBe(true);
    expect(res.notes[0].deck).toBe('Deutsch');
  });
  it('prefers a real FSRS memory state and warns when collectionCreated is missing', () => {
    const res = importAnkiJson({
      notes: [noteInfo(2)],
      cards: [{ cardId: 20, note: 2, deckName: 'D', ord: 0, type: 2, due: 5, interval: 10, memoryState: { stability: 42.5, difficulty: 6.1 } }],
    }, { now: NOW });
    expect(res.cards[0].sched.stability).toBe(42.5);
    expect(res.cards[0].sched.difficulty).toBe(6.1);
    expect(res.warnings.join(' ')).toMatch(/collectionCreated/);
  });
});
