import { describe, expect, it } from 'vitest';
import { close, dismissed, emptyQueue, request, type SheetQueue } from '../../src/core/sheetQueue';

type S = { key: string; n?: number };
const keys = (q: SheetQueue<S>) => q.items.map((s) => s.key);

describe('sheetQueue', () => {
  it('shows sheets in the order they were asked for, the next only after the first is gone', () => {
    let q = request(request(emptyQueue<S>(), { key: 'leech' }), { key: 'confused' });
    expect(keys(q)).toEqual(['leech', 'confused']);
    q = close(q, 'leech');
    // Still the head, hidden, so the second hasn't mounted yet.
    expect(keys(q)).toEqual(['leech', 'confused']);
    expect(q.leaving).toBe(true);
    q = dismissed(q, 'leech');
    expect(keys(q)).toEqual(['confused']);
    expect(q.leaving).toBe(false);
  });

  it('updates a sheet asked for twice instead of stacking it', () => {
    const q = request(request(emptyQueue<S>(), { key: 'a', n: 1 }), { key: 'a', n: 2 });
    expect(q.items).toEqual([{ key: 'a', n: 2 }]);
  });

  it('queues the same key again once the first is on its way out', () => {
    let q = request(emptyQueue<S>(), { key: 'a', n: 1 });
    q = close(q, 'a');
    q = request(q, { key: 'a', n: 2 });
    expect(q.items).toEqual([{ key: 'a', n: 1 }, { key: 'a', n: 2 }]);
    q = dismissed(q, 'a');
    expect(q.items).toEqual([{ key: 'a', n: 2 }]);
  });

  it('drops a waiting sheet that is closed before it ever showed', () => {
    let q = request(request(emptyQueue<S>(), { key: 'a' }), { key: 'b' });
    q = close(q, 'b');
    expect(keys(q)).toEqual(['a']);
    expect(q.leaving).toBe(false);
  });

  it('ignores a dismissal for a sheet that is not the one leaving', () => {
    let q = request(request(emptyQueue<S>(), { key: 'a' }), { key: 'b' });
    expect(dismissed(q, 'a')).toBe(q);
    q = close(q, 'a');
    expect(dismissed(q, 'b')).toBe(q);
  });

  it('closing the head twice changes nothing the second time', () => {
    const q = close(request(emptyQueue<S>(), { key: 'a' }), 'a');
    expect(close(q, 'a')).toBe(q);
  });
});
