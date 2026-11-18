import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { answerWord, currentWord, dropWord, isRoundDone, roundRecord, startRound, wordsLeft } from '../../src/core/cramRound';

describe('a cram round', () => {
  it('asks the words missed last time first, then the rest shuffled', () => {
    const r = startRound(['a', 'b', 'c', 'd'], new Set(['c']), () => 0);
    expect(r.queue[0]).toBe('c');
    expect([...r.queue].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('brings a missed word back a few words later, and ends once every word is got', () => {
    let r = startRound(['a', 'b', 'c', 'd', 'e'], new Set(), () => 0.999);
    expect(r.queue).toEqual(['a', 'b', 'c', 'd', 'e']);
    r = answerWord(r, false);
    expect(r.queue).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(r.missed).toEqual(['a']);
    r = answerWord(answerWord(answerWord(r, true), true), true);
    expect(currentWord(r)).toBe('a');
    r = answerWord(r, false);
    expect(r.missed).toEqual(['a']);
    expect(r.queue).toEqual(['e', 'a']);
    r = answerWord(answerWord(r, true), true);
    expect(isRoundDone(r)).toBe(true);
    expect(roundRecord(r, new Date(2026, 10, 18, 9))).toEqual({ finishedAt: new Date(2026, 10, 18, 9).toISOString(), noteIds: ['a', 'b', 'c', 'd', 'e'], missed: ['a'] });
  });

  it('counts the words left and drops a deleted one', () => {
    const r = startRound(['a', 'b'], new Set(), () => 0.999);
    expect(wordsLeft(r)).toBe(2);
    const dropped = dropWord(answerWord(r, false), 'a');
    expect(dropped).toEqual({ queue: ['b'], noteIds: ['b'], missed: [] });
    expect(answerWord({ queue: [], noteIds: [], missed: [] }, true).queue).toEqual([]);
  });

  it('imports nothing that answers, schedules or writes cards', () => {
    // A round is practice: its Missed it and Got it never reach FSRS (CLAUDE.md, "Nothing feeds FSRS but the answer button pressed").
    for (const file of ['src/core/cramRound.ts', 'src/ui/cram/CramRound.tsx']) {
      // A type (the repo's) is no way to write anything, so `import type` lines don't count.
      const code = readFileSync(join(__dirname, '..', '..', file), 'utf8').split('\n').filter((l) => !l.startsWith('import type'));
      expect(code.join('\n'), file).not.toMatch(/from '[^']*(core\/scheduler|core\/session|core\/writeQueue|anki\/[a-zA-Z/]+)'/);
    }
  });
});
