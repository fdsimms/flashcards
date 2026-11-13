import { expect, test } from 'vitest';
import {
  BANDS, KNOWN_SHARE, START_BAND, bandLabel, bandOf, bandResults, choicesFor, estimate, missedWords, nextBand, nextItem,
  type Asked, type Reply, type VocabItem,
} from '../../src/reader/vocabCheck';

// A repeatable random source (mulberry32).
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Eight words in each band, ranked from the band's start.
const bank: VocabItem[] = BANDS.flatMap((b, band) =>
  Array.from({ length: 8 }, (_, n) => ({ word: `w${band}-${n}`, rank: b.from + n, meaning: `m${band}-${n}`, wrong: ['x', 'y', 'z'] })),
);
const inBand = (band: number, n = 0) => bank[band * 8 + n];
const ask = (band: number, reply: Reply, n = 0): Asked => ({ item: inBand(band, n), reply });
const asks = (band: number, replies: Reply[]): Asked[] => replies.map((r, n) => ask(band, r, n));

test('a rank belongs to the band that holds it, and a band is labeled with its ranks', () => {
  expect(bandOf(1)).toBe(0);
  expect(bandOf(250)).toBe(1);
  expect(bandOf(251)).toBe(2);
  expect(bandOf(5000)).toBe(6);
  expect(bandOf(5001)).toBe(7);
  expect(bandOf(10000)).toBe(7);
  expect(bandOf(10001)).toBe(-1);
  expect(bandLabel(4)).toBe('1,001 to 2,000');
});

test('the questions start at the 251 to 500 band, up after a right answer and down after anything else', () => {
  expect(nextBand([])).toBe(START_BAND);
  expect(nextBand([ask(2, 'right')])).toBe(3);
  expect(nextBand([ask(2, 'right'), ask(3, 'wrong')])).toBe(2);
  expect(nextBand([ask(2, 'skipped')])).toBe(1);
});

test('the band never leaves the list', () => {
  expect(nextBand(Array.from({ length: 10 }, (_, n) => ask(6, 'right', n % 8)))).toBe(BANDS.length - 1);
  expect(nextBand(Array.from({ length: 10 }, (_, n) => ask(0, 'wrong', n % 8)))).toBe(0);
});

test('the next word comes from the next band and is never one already asked', () => {
  const rng = seeded(1);
  expect(bandOf(nextItem(bank, [], rng)!.rank)).toBe(START_BAND);
  const asked = [ask(2, 'right')];
  for (let i = 0; i < 20; i++) {
    const item = nextItem(bank, asked, seeded(i))!;
    expect(bandOf(item.rank)).toBe(3);
    expect(item.word).not.toBe(asked[0].item.word);
  }
});

test('a band with no words left falls back to the closest one, and nothing is asked when none are left', () => {
  const only = bank.filter((i) => bandOf(i.rank) === 1 || bandOf(i.rank) === 5);
  expect(bandOf(nextItem(only, [], seeded(1))!.rank)).toBe(1); // band 2 is empty; 1 is nearer than 5
  expect(nextItem([], [], seeded(1))).toBeUndefined();
  expect(nextItem(only, only.map((item) => ({ item, reply: 'right' as const })), seeded(1))).toBeUndefined();
});

test('the choices are the meaning and the three wrong ones, in an order that varies', () => {
  const item = inBand(0);
  const orders = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const choices = choicesFor(item, seeded(i));
    expect([...choices].sort()).toEqual([item.meaning, 'x', 'y', 'z'].sort());
    orders.add(choices.join());
  }
  expect(orders.size).toBeGreaterThan(1);
});

test('a band reports how many were right, with a guess allowed for', () => {
  const [result] = bandResults(asks(3, ['right', 'right', 'wrong', 'skipped']));
  expect(result).toMatchObject({ band: 3, asked: 4, right: 2 });
  expect(result.known).toBeCloseTo((2 - 1 / 3) / 4);
  expect(bandResults(asks(3, ['wrong', 'wrong', 'wrong'])) [0].known).toBe(0); // never below none
  expect(bandResults([])).toEqual([]);
});

test('every band right suggests the top setting', () => {
  const all = BANDS.flatMap((_, band) => asks(band, ['right', 'right']));
  expect(estimate(all).suggested).toBe(10000);
});

test('the suggestion is the largest setting whose words are known at the target share', () => {
  // Right through 1,000, then half of the 1,001 to 2,000 band, none of the rest.
  const asked = [
    ...asks(0, ['right', 'right']), ...asks(1, ['right', 'right']), ...asks(2, ['right', 'right']),
    ...asks(3, ['right', 'right', 'right']),
    ...asks(4, ['right', 'skipped']),
    ...asks(5, ['skipped', 'skipped']),
  ];
  const { suggested } = estimate(asked);
  // 1,000 words at 100% is above the target; 2,000 is (1,000 + 500) / 2,000 = 75%, below it.
  expect(suggested).toBe(1000);
  expect(KNOWN_SHARE).toBe(0.9);
});

test('a few misses in a big band still pass when the commoner bands are all known', () => {
  // 500 words known at 100%; the 501 to 1,000 band at 80% still leaves 1,000 at 90%.
  const asked = [...asks(0, ['right']), ...asks(1, ['right']), ...asks(2, ['right']), ...asks(3, ['right', 'right', 'right', 'right', 'skipped'])];
  expect(estimate(asked).suggested).toBe(1000);
});

test('too little known suggests none, and no answers suggest none', () => {
  expect(estimate(asks(0, ['wrong', 'skipped'])).suggested).toBe(0);
  expect(estimate([]).suggested).toBe(0);
});

test('a band never asked takes the commoner one as known, or the average of its neighbors', () => {
  // Only band 3 (501 to 1,000) asked, all right: bands 0 to 2 are taken as known too.
  expect(estimate(asks(3, ['right', 'right'])).suggested).toBe(1000);
  // Bands 2 and 4 asked, 2 all right and 4 none right, so band 3 between them is taken at 50%.
  const between = [...asks(2, ['right', 'right']), ...asks(4, ['wrong', 'wrong'])];
  // 1,000 would be 250 + 250 + 250 (half of 500) = 750 of 1,000, under the target; 500 is all known.
  expect(estimate(between).suggested).toBe(500);
});

test('nothing above the highest band asked is suggested', () => {
  expect(estimate(asks(1, ['right', 'right'])).suggested).toBe(250);
});

test('the 3,001 to 5,000 band right but nothing asked above it suggests 5,000', () => {
  const asked = BANDS.slice(0, 7).flatMap((_, band) => asks(band, ['right', 'right']));
  expect(estimate(asked).suggested).toBe(5000);
});

test('missed words are the wrong and skipped answers in order, with the meaning picked for a wrong one', () => {
  const asked: Asked[] = [
    ask(2, 'right'),
    { ...ask(3, 'wrong'), picked: 'x' },
    ask(2, 'skipped', 1),
  ];
  expect(missedWords(asked)).toEqual([
    { item: inBand(3), band: 3, picked: 'x' },
    { item: inBand(2, 1), band: 2, picked: undefined },
  ]);
  expect(missedWords([ask(2, 'right')])).toEqual([]);
});
