import { describe, expect, it } from 'vitest';
import { WaniKaniError } from '../../src/wanikani/api';
import { apprenticeBlocks, DEFAULT_PREFS, droppedLine, droppedText, flushOutbox, lessonsToday, parsePrefs, parseState } from '../../src/wanikani/prefs';
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

  it('holds lessons back only while more items are at Apprentice than the limit', () => {
    expect(DEFAULT_PREFS.maxApprentice).toBeNull();
    expect(apprenticeBlocks(500, null)).toBe(false);
    expect(apprenticeBlocks(100, 100)).toBe(false);
    expect(apprenticeBlocks(101, 100)).toBe(true);
    expect(lessonsToday(40, 15, 0, 101, 100)).toBe(0);
    expect(lessonsToday(40, 15, 0, 100, 100)).toBe(15);
    expect(lessonsToday(40, 15, 0, 500, null)).toBe(15);
  });

  it('keeps a saved Apprentice limit and reads anything else as no limit', () => {
    expect(parsePrefs(JSON.stringify({ maxApprentice: 100 })).maxApprentice).toBe(100);
    expect(parsePrefs(JSON.stringify({ maxApprentice: 0 })).maxApprentice).toBe(0);
    expect(parsePrefs(JSON.stringify({ maxApprentice: -5 })).maxApprentice).toBeNull();
    expect(parsePrefs(JSON.stringify({ maxApprentice: 'lots' })).maxApprentice).toBeNull();
  });
});

describe('answers waiting to be sent', () => {
  it('reads back what was saved, dropping anything malformed', () => {
    const entry = { at: '2026-11-12T12:00:00.000Z', assignmentId: 1, kind: 'review', wrong: 0, takenMs: 5000 };
    expect(parseState(JSON.stringify({ outbox: [review(1), { kind: 'x' }], made: [1, 'a'], log: [entry, { at: 1 }] })))
      .toEqual({ outbox: [review(1)], sent: [], made: [1], log: [entry], dropped: 0 });
    expect(parseState(JSON.stringify({ sent: [review(2), 5] })).sent).toEqual([review(2)]);
    expect(parseState(null)).toEqual({ outbox: [], sent: [], made: [], log: [], dropped: 0 });
  });

  it('keeps the count of refused answers not yet shown', () => {
    expect(parseState(JSON.stringify({ dropped: 3 })).dropped).toBe(3);
    expect(parseState(JSON.stringify({ dropped: -1 })).dropped).toBe(0);
    expect(parseState(JSON.stringify({ dropped: 'x' })).dropped).toBe(0);
  });

  it('says how many refused answers were dropped and why, with nothing to do', () => {
    expect(droppedText(1)).toBe("1 answer wasn't sent: WaniKani already had a newer answer for that item, from wanikani.com or another app. WaniKani keeps that one, so there's nothing to do.");
    expect(droppedText(3)).toBe("3 answers weren't sent: WaniKani already had newer answers for those items, from wanikani.com or another app. WaniKani keeps those, so there's nothing to do.");
    expect(droppedLine(1)).toBe("1 answer wasn't sent: WaniKani had a newer one");
    expect(droppedLine(3)).toBe("3 answers weren't sent: WaniKani had newer ones");
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
