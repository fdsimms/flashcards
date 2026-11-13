import { expect, test } from 'vitest';
import {
  BANDS, KNOWN_SHARE, START_BAND, bandLabel, bandOf, bandResults, choicesFor, estimate, missedWords, parseSeen, rememberSeen, nextBand, nextItem,
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

const at = (rank: number, reply: Reply): Asked => ({ item: { word: `r${rank}`, rank, meaning: '', wrong: ['x', 'y', 'z'] }, reply });

test('the suggestion is the largest setting whose words are known at the target share', () => {
  // Right through 1,000, then half of the 1,001 to 2,000 band, none of the rest.
  const asked = [
    ...asks(0, ['right', 'right']), ...asks(1, ['right', 'right']), ...asks(2, ['right', 'right']),
    ...asks(3, ['right', 'right', 'right']),
    ...asks(4, ['right', 'skipped']),
    ...asks(5, ['skipped', 'skipped']),
  ];
  const { suggested } = estimate(asked);
  expect(suggested).toBeGreaterThanOrEqual(500);
  expect(suggested).toBeLessThanOrEqual(1000);
  expect(KNOWN_SHARE).toBe(0.9);
});

test('one miss in a small band does not outweigh a band of right answers above it', () => {
  // A real result: right through 2,000 bar one wrong, 9 of 9 in 2,001 to 3,000, 3 of 5 in 3,001 to 5,000.
  // Scoring each band alone suggested 1,000 here.
  const asked = [
    at(300, 'right'), at(700, 'right'),
    at(1100, 'right'), at(1300, 'right'), at(1500, 'right'), at(1800, 'wrong'),
    ...[2100, 2200, 2400, 2500, 2600, 2700, 2800, 2900, 2950].map((r) => at(r, 'right')),
    at(3100, 'right'), at(3500, 'right'), at(4000, 'right'), at(4300, 'wrong'), at(4800, 'skipped'),
  ];
  expect(estimate(asked).suggested).toBe(3000);
});

test('missing everything past a point suggests a setting below it', () => {
  const asked = [
    ...asks(1, ['right', 'right']), ...asks(2, ['right', 'right']), ...asks(3, ['right', 'right']),
    ...asks(4, ['wrong', 'skipped', 'wrong']), ...asks(5, ['skipped', 'wrong']),
  ];
  expect(estimate(asked).suggested).toBeLessThanOrEqual(1000);
});

test('too little known suggests none, and no answers suggest none', () => {
  expect(estimate(asks(0, ['wrong', 'skipped'])).suggested).toBe(0);
  expect(estimate([]).suggested).toBe(0);
});

test('only an easy band asked and all right suggests up to that band', () => {
  expect(estimate(asks(3, ['right', 'right'])).suggested).toBe(1000);
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

test('a retake asks words not seen before while any are left within a band of the next one', () => {
  const seen = new Set(bank.filter((i) => bandOf(i.rank) === 2).slice(0, 7).map((i) => i.word));
  for (let n = 0; n < 20; n++) expect(nextItem(bank, [], seeded(n), seen)!.word).toBe(inBand(2, 7).word);
  // With band 2 all seen, band 1 or 3 (a band away) has unseen words, and is used before a seen band 2 word.
  const all2 = new Set(bank.filter((i) => bandOf(i.rank) === 2).map((i) => i.word));
  for (let n = 0; n < 20; n++) expect([1, 3]).toContain(bandOf(nextItem(bank, [], seeded(n), all2)!.rank));
});

test('seen words are used when nothing unseen is left near the level, and are never required', () => {
  const near = bank.filter((i) => Math.abs(bandOf(i.rank) - START_BAND) <= 1);
  const seen = new Set(near.map((i) => i.word));
  expect(bandOf(nextItem(bank, [], seeded(1), seen)!.rank)).toBe(START_BAND);
  expect(nextItem(bank, [], seeded(1), new Set())).toBeDefined();
});

test('the words asked are remembered, kept to the bank, and start over once every word has been seen', () => {
  const some = bank.slice(0, 3);
  expect(rememberSeen(['gone', some[0].word], some.map((item) => ({ item, reply: 'right' as Reply })), bank).sort()).toEqual(some.map((i) => i.word).sort());
  expect(rememberSeen(bank.slice(1).map((i) => i.word), [{ item: bank[0], reply: 'right' }], bank)).toEqual([]);
});

test('saved words that are not a list of words read as none seen', () => {
  expect(parseSeen('["a","b"]')).toEqual(['a', 'b']);
  expect(parseSeen('["a",3]')).toEqual(['a']);
  expect(parseSeen('{"a":1}')).toEqual([]);
  expect(parseSeen('nope')).toEqual([]);
  expect(parseSeen(null)).toEqual([]);
});
