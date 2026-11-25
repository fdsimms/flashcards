import { describe, expect, it } from 'vitest';
import { createPacer, nextSlot, REQUESTS_PER_MINUTE, retryDelay, WINDOW_MS } from '../../src/wanikani/pace';

const T = new Date(2026, 10, 25, 12).getTime();

describe('nextSlot', () => {
  it('goes now while fewer than the limit went in the last minute', () => {
    expect(nextSlot([T - 1000, T - 500], T, 0, 3)).toBe(T);
  });

  it('waits until the oldest of the last `limit` is a minute old', () => {
    expect(nextSlot([T - 10_000, T - 5000, T - 1000], T, 0, 3)).toBe(T - 10_000 + WINDOW_MS);
  });

  it('never goes before a refusal’s reset, or before one already booked', () => {
    expect(nextSlot([], T, T + 30_000, 3)).toBe(T + 30_000);
    expect(nextSlot([T + 2000], T, 0, 3)).toBe(T + 2000);
  });
});

describe('retryDelay', () => {
  it('waits until RateLimit-Reset, in epoch seconds', () => {
    expect(retryDelay(String((T + 12_000) / 1000), T)).toBe(12_000);
  });

  it('waits a minute when there is no reset or it is not a number', () => {
    expect(retryDelay(null, T)).toBe(WINDOW_MS);
    expect(retryDelay('soon', T)).toBe(WINDOW_MS);
  });

  it('keeps a reset in the past or far ahead to between a second and a little over a minute', () => {
    expect(retryDelay(String((T - 5000) / 1000), T)).toBe(1000);
    expect(retryDelay(String((T + 3_600_000) / 1000), T)).toBe(65_000);
  });
});

function clocked() {
  let now = T;
  const slept: number[] = [];
  const pacer = createPacer(() => now, async (ms) => { slept.push(ms); now += ms; });
  return { pacer, slept, advance: (ms: number) => { now += ms; } };
}

describe('createPacer', () => {
  it('lets a burst up to the limit through at once, and spaces the rest a minute behind', async () => {
    const { pacer, slept } = clocked();
    for (let i = 0; i < REQUESTS_PER_MINUTE; i++) await pacer.wait();
    expect(slept).toEqual([]);
    await pacer.wait();
    expect(slept).toEqual([WINDOW_MS]);
  });

  it('gives requests asking at the same moment a slot each', async () => {
    // The clock stands still, as it does while a Promise.all starts its requests.
    const slept: number[] = [];
    const pacer = createPacer(() => T, async (ms) => { slept.push(ms); });
    await Promise.all(Array.from({ length: REQUESTS_PER_MINUTE + 2 }, () => pacer.wait()));
    expect(slept).toEqual([WINDOW_MS, WINDOW_MS]);
  });

  it('forgets requests more than a minute old', async () => {
    const { pacer, slept, advance } = clocked();
    for (let i = 0; i < REQUESTS_PER_MINUTE; i++) await pacer.wait();
    advance(WINDOW_MS + 1);
    await pacer.wait();
    expect(slept).toEqual([]);
  });

  it('holds every request after a refusal', async () => {
    const { pacer, slept } = clocked();
    pacer.hold(20_000);
    await pacer.wait();
    expect(slept).toEqual([20_000]);
  });
});
