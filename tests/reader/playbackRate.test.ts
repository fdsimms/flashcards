import { expect, test } from 'vitest';
import { isSlow, NORMAL_RATE, RATES, SLOW_RATE, toRate } from '../../src/reader/playbackRate';

test('offers slow then normal', () => {
  expect(RATES).toEqual([SLOW_RATE, NORMAL_RATE]);
});

test('a speed saved from the four the reader once offered keeps its meaning', () => {
  expect([0.7, 0.8, 0.9].map(toRate)).toEqual([SLOW_RATE, SLOW_RATE, SLOW_RATE]);
  expect(toRate(1)).toBe(NORMAL_RATE);
});

test('falls back to normal for anything else', () => {
  expect([Number.NaN, 2, '0.8', null, undefined].map(toRate)).toEqual([NORMAL_RATE, NORMAL_RATE, NORMAL_RATE, NORMAL_RATE, NORMAL_RATE]);
});

test('only a rate below normal asks for the slow recording', () => {
  expect(isSlow(SLOW_RATE)).toBe(true);
  expect(isSlow(NORMAL_RATE)).toBe(false);
});
