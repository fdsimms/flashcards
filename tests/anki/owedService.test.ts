import { describe, expect, it } from 'vitest';
import type { OwedAnswer } from '../../src/anki/owedAnswers';
import { settleOwedAnkiAnswers } from '../../src/anki/owedService';
import { makeCards } from '../../src/core/cards';
import type { Card } from '../../src/core/types';
import { NOW, omniNote } from '../support/fixtures';

const [card] = makeCards(omniNote(), NOW);
const sibling = { ...card, id: `${card.id}-sibling` };
const answerOf = (reps: number): OwedAnswer => ({
  answer: { before: card, after: { ...card, sched: { ...card.sched, reps } }, rating: 3, now: NOW, takenMs: 1000 },
  buried: [{ ...sibling, buriedAt: NOW.toISOString() }],
});

/** A collection that takes, has already taken, or refuses each owed answer by its id. */
function fakeRepo(rows: { id: number; owed: OwedAnswer }[], outcome: Record<number, 'written' | 'nothing' | 'refused'>) {
  const left = new Set(rows.map((r) => r.id));
  const saved: Card[] = [];
  const written: number[] = [];
  return {
    left, saved, written,
    owedAnkiAnswers: async () => rows,
    writeAnkiAnswer: async (a: { owedId?: number }) => {
      const id = a.owedId!;
      if (outcome[id] === 'refused') throw new Error('no such card');
      left.delete(id);
      if (outcome[id] === 'nothing') return undefined;
      written.push(id);
      return { cid: 1, row: {} as never, revlogId: id, buried: [], decks: [] };
    },
    forgetOwedAnkiAnswer: async (id: number) => { left.delete(id); },
    saveCard: async (c: Card) => { saved.push(c); },
  };
}

describe('writing the answers owed at launch', () => {
  it('writes each in order and saves its card and buried siblings again', async () => {
    const repo = fakeRepo([{ id: 1, owed: answerOf(1) }, { id: 2, owed: answerOf(2) }], { 1: 'written', 2: 'written' });
    expect(await settleOwedAnkiAnswers(repo)).toBe(0);
    expect(repo.written).toEqual([1, 2]);
    expect(repo.saved.map((c) => [c.id, c.sched.reps])).toEqual([[card.id, 1], [sibling.id, sibling.sched.reps], [card.id, 2], [sibling.id, sibling.sched.reps]]);
    expect([...repo.left]).toEqual([]);
  });

  it('saves nothing for one already in the collection', async () => {
    const repo = fakeRepo([{ id: 1, owed: answerOf(1) }], { 1: 'nothing' });
    expect(await settleOwedAnkiAnswers(repo)).toBe(0);
    expect(repo.saved).toEqual([]);
  });

  it('counts and drops one the collection refuses, and goes on', async () => {
    const repo = fakeRepo([{ id: 1, owed: answerOf(1) }, { id: 2, owed: answerOf(2) }], { 1: 'refused', 2: 'written' });
    expect(await settleOwedAnkiAnswers(repo)).toBe(1);
    expect(repo.written).toEqual([2]);
    expect([...repo.left]).toEqual([]);
  });
});
