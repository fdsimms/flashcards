import { describe, expect, it } from 'vitest';
import { decodeOwed, encodeOwed, type OwedAnswer } from '../../src/anki/owedAnswers';
import { makeCards } from '../../src/core/cards';
import { NOW, omniNote } from '../support/fixtures';

const [card] = makeCards(omniNote(), NOW);
const sibling = { ...card, id: `${card.id}-sibling` };
const owed = (over: Partial<OwedAnswer['answer']> = {}): OwedAnswer => ({
  answer: { before: { ...card, ankiId: '1700000000000' }, after: { ...card, ankiId: '1700000000000', sched: { ...card.sched, reps: 1 } }, rating: 3, now: NOW, takenMs: 4200, desiredRetention: 0.9, steps: { learn: 2, relearn: 1 }, weights: [], bury: [sibling], ...over },
  buried: [{ ...sibling, buriedAt: NOW.toISOString() }],
});

describe('an answer owed to the Anki collection, kept as text', () => {
  it('comes back as it went in, the time included', () => {
    const back = decodeOwed(encodeOwed(owed()));
    expect(back).toEqual(owed());
    expect(back!.answer.now.getTime()).toBe(NOW.getTime());
  });

  it('keeps a filtered deck preview, with or without its time to show again', () => {
    const again = new Date(2026, 10, 11, 12, 10);
    expect(decodeOwed(encodeOwed(owed({ preview: { again } })))!.answer.preview).toEqual({ again });
    expect(decodeOwed(encodeOwed(owed({ preview: {} })))!.answer.preview).toEqual({});
    expect(decodeOwed(encodeOwed(owed()))!.answer.preview).toBeUndefined();
  });

  it('reads nothing from text that is not one', () => {
    expect(decodeOwed('not json')).toBeNull();
    expect(decodeOwed('{}')).toBeNull();
    const text = encodeOwed(owed());
    expect(decodeOwed(text.replace('"rating":3', '"rating":7'))).toBeNull();
    const raw = JSON.parse(text);
    expect(decodeOwed(JSON.stringify({ ...raw, answer: { ...raw.answer, now: 'yesterday' } }))).toBeNull();
    expect(decodeOwed(JSON.stringify({ ...JSON.parse(text), buried: 'none' }))).toBeNull();
  });
});
