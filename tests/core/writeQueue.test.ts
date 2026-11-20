import { describe, expect, it } from 'vitest';
import { ankiWrites, reviewWrites, WriteQueue } from '../../src/core/writeQueue';

const gate = () => {
  let open!: () => void;
  const promise = new Promise<void>((r) => { open = r; });
  return { promise, open };
};

describe('WriteQueue', () => {
  it('runs jobs one at a time, in the order added', async () => {
    const q = new WriteQueue();
    const log: string[] = [];
    const first = gate();
    q.add(async () => { log.push('a start'); await first.promise; log.push('a end'); });
    q.add(async () => { log.push('b'); });
    await Promise.resolve();
    expect(log).toEqual(['a start']);
    first.open();
    await q.idle();
    expect(log).toEqual(['a start', 'a end', 'b']);
  });

  it('returns the job\'s own result', async () => {
    const q = new WriteQueue();
    expect(await q.add(async () => 7)).toBe(7);
  });

  it('runs the next job after one fails, and idle() still resolves', async () => {
    const q = new WriteQueue();
    const failed = q.add(async () => { throw new Error('disk'); });
    const after = q.add(async () => 'ok');
    await expect(failed).rejects.toThrow('disk');
    expect(await after).toBe('ok');
    await expect(q.idle()).resolves.toBeUndefined();
  });

  it('counts pending jobs down as they finish', async () => {
    const q = new WriteQueue();
    const g = gate();
    q.add(() => g.promise);
    q.add(async () => {});
    expect(q.pending).toBe(2);
    g.open();
    await q.idle();
    await Promise.resolve();
    expect(q.pending).toBe(0);
  });

  it('idle() waits for the job still running', async () => {
    const q = new WriteQueue();
    const g = gate();
    q.add(() => g.promise);
    const done: string[] = [];
    const waiting = q.idle().then(() => done.push('idle'));
    g.open();
    await waiting;
    expect(done).toEqual(['idle']);
  });
});

describe("Review's two queues", () => {
  it('are both waited for by reviewWrites.idle(), the Anki half queued from inside the first', async () => {
    const collection = gate();
    const log: string[] = [];
    void reviewWrites.add(async () => {
      log.push('saved in Franki');
      void ankiWrites.add(async () => { await collection.promise; log.push('written to Anki'); });
    });
    // A second answer's rows don't wait for the first one's Anki write.
    await reviewWrites.add(async () => { log.push('second saved in Franki'); });
    expect(log).toEqual(['saved in Franki', 'second saved in Franki']);
    let idle = false;
    const waiting = reviewWrites.idle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);
    collection.open();
    await waiting;
    expect(log).toEqual(['saved in Franki', 'second saved in Franki', 'written to Anki']);
  });
});
