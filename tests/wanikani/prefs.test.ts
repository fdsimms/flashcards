import { describe, expect, it } from 'vitest';
import { WaniKaniError } from '../../src/wanikani/api';
import { DEFAULT_PREFS, flushOutbox, lessonsToday, parsePrefs, parseState } from '../../src/wanikani/prefs';
import type { Outcome } from '../../src/wanikani/session';

const review = (id: number): Outcome => ({ kind: 'review', assignmentId: id, subjectId: id, srsStage: 1, wrongMeaning: 0, wrongReading: 0, at: '2026-11-12T12:00:00.000Z' });

describe('options', () => {
  it('starts typed, with meaning and reading asked apart', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toMatchObject({ answer: 'type', separate: true });
  });

  it('keeps what was saved and drops what it cannot read', () => {
    expect(parsePrefs(JSON.stringify({ answer: 'flip', separate: false, newPerDay: 5, productionDeck: 'J' })))
      .toEqual({ ...DEFAULT_PREFS, answer: 'flip', separate: false, newPerDay: 5, productionDeck: 'J' });
    expect(parsePrefs(JSON.stringify({ answer: 'shout', newPerDay: -1 }))).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('{nope')).toEqual(DEFAULT_PREFS);
  });

  it("offers today's lessons up to the limit, counting ones done on WaniKani", () => {
    expect(lessonsToday(40, 15, 0)).toBe(15);
    expect(lessonsToday(40, 15, 10)).toBe(5);
    expect(lessonsToday(40, 15, 20)).toBe(0);
    expect(lessonsToday(3, 15, 0)).toBe(3);
  });
});

describe('answers waiting to be sent', () => {
  it('reads back what was saved, dropping anything malformed', () => {
    expect(parseState(JSON.stringify({ outbox: [review(1), { kind: 'x' }], made: [1, 'a'] }))).toEqual({ outbox: [review(1)], made: [1] });
    expect(parseState(null)).toEqual({ outbox: [], made: [] });
  });

  it('sends in order, drops what WaniKani refuses, and stops when it cannot reach it', async () => {
    const sent: number[] = [];
    const result = await flushOutbox([review(1), review(2), review(3), review(4)], async (o) => {
      if (o.assignmentId === 2) throw new WaniKaniError('rejected', 422);
      if (o.assignmentId === 3) throw new WaniKaniError('unavailable');
      sent.push(o.assignmentId);
    });
    expect(sent).toEqual([1]);
    expect(result.dropped).toEqual([review(2)]);
    expect(result.left).toEqual([review(3), review(4)]);
    expect(result.problem).toBe('unavailable');
  });

  it('sends everything when it can', async () => {
    const result = await flushOutbox([review(1), review(2)], async () => undefined);
    expect(result).toEqual({ left: [], sent: [review(1), review(2)], dropped: [] });
  });
});
