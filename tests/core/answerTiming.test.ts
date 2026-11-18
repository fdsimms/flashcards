import { describe, expect, it } from 'vitest';
import { median, TIMING_SAMPLES, timingLine, withSample } from '../../src/core/answerTiming';

describe('answer timing', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([])).toBeUndefined();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([40, 10, 30, 20])).toBe(25);
  });

  it('keeps the latest samples only', () => {
    let recent: number[] = [];
    for (let i = 0; i < TIMING_SAMPLES + 5; i++) recent = withSample(recent, i);
    expect(recent).toHaveLength(TIMING_SAMPLES);
    expect(recent.at(-1)).toBe(TIMING_SAMPLES + 4);
  });

  it('says each step once it is known, and what is usual once there are a few', () => {
    expect(timingLine(undefined, [])).toBeNull();
    expect(timingLine({}, [])).toBeNull();
    expect(timingLine({ shown: 47.6 }, [47.6])).toBe('Card shown: 48 ms.');
    expect(timingLine({ shown: 47.6, queue: 61.2 }, [60, 40, 47.6])).toBe('Card shown: 48 ms (usually 48). Queue: 61 ms.');
    expect(timingLine({ shown: 50, queue: 61, saved: 140.4 }, [50, 52, 54, 56])).toBe('Card shown: 50 ms (usually 53). Queue: 61 ms. Saved: 140 ms.');
    // The queue can be rebuilt before the card is shown (nothing else was queued to show first).
    expect(timingLine({ queue: 61 }, [])).toBe('Queue: 61 ms.');
  });
});
