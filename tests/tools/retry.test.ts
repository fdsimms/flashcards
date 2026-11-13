import { describe, expect, it } from 'vitest';
import { nextQuestion, noRetries, queueMiss, RETRY_AFTER_MAX, RETRY_AFTER_MIN, type Retries } from '../../src/tools/retry';

/**
 * A session of numbered questions: fresh ones are drawn 100, 101, 102..., and `missed` says which
 * to miss. Returns what was shown, in order.
 */
function session(count: number, missed: (q: number, shown: number[]) => boolean, random: () => number = () => 0, first = 1): number[] {
  let fresh = 100;
  let retries: Retries<number> = noRetries('pl');
  const shown = [first];
  while (shown.length < count) {
    const q = shown[shown.length - 1];
    if (missed(q, shown)) retries = queueMiss(retries, 'pl', String(q), q, random);
    const next = nextQuestion(retries, 'pl', String(q), () => fresh++);
    retries = next.retries;
    shown.push(next.item);
  }
  return shown;
}

describe('a missed question coming back', () => {
  it(`comes back ${RETRY_AFTER_MIN} questions later at the soonest`, () => {
    const shown = session(8, (q) => q === 1, () => 0);
    expect(shown).toEqual([1, 100, 101, 1, 102, 103, 104, 105]);
  });

  it(`comes back ${RETRY_AFTER_MAX} questions later at the latest`, () => {
    const shown = session(8, (q) => q === 1, () => 0.999);
    expect(shown).toEqual([1, 100, 101, 102, 103, 1, 104, 105]);
  });

  it('waits somewhere in between for anything else random gives', () => {
    for (const r of [0.34, 0.5, 0.66]) {
      const shown = session(8, (q) => q === 1, () => r);
      expect(shown.indexOf(1, 1)).toBe(4);
    }
  });

  it('comes back only once, even when missed again on its retry', () => {
    const shown = session(14, (q) => q === 1, () => 0);
    expect(shown.filter((q) => q === 1)).toHaveLength(2);
  });

  it('is not queued for a right answer', () => {
    expect(session(10, () => false)).toEqual([1, 100, 101, 102, 103, 104, 105, 106, 107, 108]);
  });

  it('brings several misses back in the order they were made, one at a time', () => {
    // 1 waits the longest (5), 100 the shortest (3): 100 is due first but still comes after 1.
    const waits = [0.999, 0];
    let i = 0;
    const shown = session(10, (q) => q === 1 || q === 100, () => waits[i++] ?? 0);
    expect(shown).toEqual([1, 100, 101, 102, 103, 1, 100, 104, 105, 106]);
  });

  it('never shows the same question twice in a row', () => {
    // 1 is missed; then the question showing when it's due is 1 again (set by hand, say).
    let retries = queueMiss(noRetries<number>('pl'), 'pl', '1', 1, () => 0);
    let fresh = 100;
    const draw = () => fresh++;
    for (const q of [100, 101]) retries = nextQuestion(retries, 'pl', String(q), draw).retries;
    const held = nextQuestion(retries, 'pl', '1', draw);
    expect(held.item).toBe(102);
    expect(nextQuestion(held.retries, 'pl', '102', draw).item).toBe(1);
  });

  it('keeps every question random when nothing was missed', () => {
    let calls = 0;
    const { item } = nextQuestion(noRetries<number>('pl'), 'pl', '1', () => { calls++; return 7; });
    expect(item).toBe(7);
    expect(calls).toBe(1);
  });

  it('starts over in another scope: a miss in Polish is not handed back in Russian', () => {
    const retries = queueMiss(noRetries<number>('pl'), 'pl', '1', 1, () => 0);
    let r = retries;
    let fresh = 100;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = nextQuestion(r, 'ru', String(seen.at(-1) ?? 0), () => fresh++);
      r = next.retries;
      seen.push(next.item);
    }
    expect(seen).not.toContain(1);
    expect(r.scope).toBe('ru');
  });
});
