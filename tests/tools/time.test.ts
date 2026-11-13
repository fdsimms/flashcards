import { describe, expect, it } from 'vitest';
import { clockText, heardAs, MINUTE_STEPS, randomTime } from '../../src/tools/time';
import { TIME_SAYERS } from '../../src/tools/tools';

/** A random() that returns each of `values` in turn. */
const sequence = (...values: number[]) => () => values.shift() ?? 0;

describe('a random time', () => {
  it('keeps its minutes to multiples of the step', () => {
    for (const step of MINUTE_STEPS) {
      for (let i = 0; i < 200; i++) {
        const t = randomTime(step);
        expect(t.minute % step).toBe(0);
        expect(t.hour).toBeGreaterThanOrEqual(0);
        expect(t.hour).toBeLessThan(24);
        expect(t.minute).toBeLessThan(60);
      }
    }
  });

  it('covers the whole day, the last slot included', () => {
    expect(randomTime(1, undefined, () => 0)).toEqual({ hour: 0, minute: 0 });
    expect(randomTime(1, undefined, () => 0.99999)).toEqual({ hour: 23, minute: 59 });
    expect(randomTime(15, undefined, () => 0.99999)).toEqual({ hour: 23, minute: 45 });
  });

  it('never gives the previous time again', () => {
    expect(randomTime(30, { hour: 0, minute: 0 }, sequence(0, 0))).toEqual({ hour: 0, minute: 30 });
    expect(randomTime(30, { hour: 23, minute: 30 }, sequence(0.99999, 0.99999))).toEqual({ hour: 23, minute: 0 });
  });

  it('can follow a previous time that is off the step', () => {
    expect(randomTime(30, { hour: 9, minute: 41 }, () => 0)).toEqual({ hour: 0, minute: 0 });
  });
});

describe('a time in digits', () => {
  it('pads hours and minutes', () => {
    expect(clockText({ hour: 9, minute: 5 })).toBe('09:05');
    expect(clockText({ hour: 23, minute: 59 })).toBe('23:59');
  });
});

describe('a clock set to the time heard', () => {
  const at = (hour: number, minute: number) => ({ hour, minute });

  it('is right for any time said the same way', () => {
    // fünf vor halb drei says nothing of the afternoon.
    expect(heardAs(at(2, 25), at(14, 25), TIME_SAYERS.de!)).toBe(true);
    expect(heardAs(at(14, 25), at(14, 25), TIME_SAYERS.de!)).toBe(true);
    expect(heardAs(at(0, 0), at(12, 0), TIME_SAYERS.es!)).toBe(true);
  });

  it('tells them apart where the words do', () => {
    expect(heardAs(at(2, 0), at(14, 0), TIME_SAYERS.th!)).toBe(false);
    expect(heardAs(at(0, 0), at(12, 0), TIME_SAYERS.fr!)).toBe(false);
    expect(heardAs(at(2, 30), at(2, 25), TIME_SAYERS.de!)).toBe(false);
  });
});
