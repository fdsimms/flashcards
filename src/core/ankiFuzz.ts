/**
 * Anki's interval fuzz and load balancer, ported to match Anki 26.09.4 bit for bit (rslib
 * scheduler/states/fuzz.rs and load_balancer.rs, answering/learning.rs), with its random numbers
 * (rand 0.9.4's StdRng: ChaCha12 seeded by rand_core's PCG32 expansion). Checked against outputs
 * recorded from the real `anki` package (tests/fixtures/anki/fuzz-vectors.json).
 *
 * Anki computes in f32: every step here goes through `Math.fround` where Anki's does.
 */

const f32 = Math.fround;
const M64 = (1n << 64n) - 1n;
const U32_MAX = 0xffffffff;

// ==== random numbers ====

const rotl = (v: number, c: number) => ((v << c) | (v >>> (32 - c))) >>> 0;

/**
 * The first block of output of `StdRng::seed_from_u64(seed)`: ChaCha12 with the 32-byte seed
 * expanded by PCG32 (rand_core 0.9.3), block counter 0, stream 0. Anki only ever reads its first
 * one or two words, from a fresh generator.
 */
export function stdRngBlock(seed: bigint): number[] {
  let s = BigInt.asUintN(64, seed);
  const key: number[] = [];
  for (let i = 0; i < 8; i++) {
    s = (s * 6364136223846793005n + 11634580027462260723n) & M64;
    const xs = Number((((s >> 18n) ^ s) >> 27n) & 0xffffffffn);
    const rot = Number(s >> 59n);
    key.push(((xs >>> rot) | (xs << ((32 - rot) & 31))) >>> 0);
  }
  const input = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574, ...key, 0, 0, 0, 0];
  const x = input.slice();
  const qr = (a: number, b: number, c: number, d: number) => {
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 16);
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 12);
    x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 8);
    x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 6; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  return x.map((v, i) => (v + input[i]) >>> 0);
}

/** Anki's fuzz factor for a seed: `random_range(0.0..1.0)` as an f32, exactly (w0 >> 9) / 2^23. */
export function fuzzFactor(seed: bigint): number {
  return (stdRngBlock(seed)[0] >>> 9) / 8388608;
}

/** rand's `random_range(low..high)` for u32 (Canon's method, as Anki builds it), from a fresh generator. */
function rangeU32(seed: bigint, low: number, high: number): number {
  const [w0, w1] = stdRngBlock(seed);
  const range = BigInt(high - low);
  const m = BigInt(w0) * range;
  let result = m >> 32n;
  const lo = m & 0xffffffffn;
  if (lo > (1n << 32n) - range) {
    const hi2 = (BigInt(w1) * range) >> 32n;
    if (lo + hi2 > 0xffffffffn) result += 1n;
  }
  return low + Number(result);
}

/** The seed Anki fuzzes an answer with: the card's id plus its reps before the answer. */
export function fuzzSeed(ankiCardId: string | undefined, repsBefore: number): bigint | undefined {
  return ankiCardId && /^\d+$/.test(ankiCardId) ? BigInt.asUintN(64, BigInt(ankiCardId) + BigInt(repsBefore)) : undefined;
}

// ==== learning steps ====

/** A learning step's length with Anki's fuzz: up to a quarter of it, at most 5 minutes, more. */
export function learningStepWithFuzz(seed: bigint | undefined, secs: number): number {
  if (seed === undefined) return secs;
  const extra = Math.trunc(Math.min(f32(f32(secs) * f32(0.25)), 300));
  return extra === 0 ? secs : rangeU32(seed, secs, secs + extra);
}

// ==== review intervals ====

/** Rust's f32::round (half away from zero), then `as u32` (saturating, NaN to 0). */
const roundU32 = (x: number) => asU32(x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5));
const asU32 = (x: number) => (x !== x || x <= 0 ? 0 : Math.min(Math.trunc(x), U32_MAX));

const F32_MAX = 3.4028234663852886e38;
const FUZZ_RANGES: [number, number, number][] = [[f32(2.5), f32(7), f32(0.15)], [f32(7), f32(20), f32(0.1)], [f32(20), F32_MAX, f32(0.05)]];

function fuzzDelta(iv: number): number {
  if (iv < 2.5) return 0;
  let d = f32(1);
  for (const [start, end, factor] of FUZZ_RANGES) d = f32(d + f32(factor * Math.max(f32(Math.min(iv, end) - start), 0)));
  return d;
}

/** The range of days an interval may be fuzzed to, within `min` and `max` (fuzz.rs). */
export function constrainedFuzzBounds(iv: number, min: number, max: number): [number, number] {
  min = Math.min(min, max);
  iv = Math.min(Math.max(iv, f32(min)), f32(max));
  const d = fuzzDelta(iv);
  let lo = roundU32(f32(iv - d));
  let hi = roundU32(f32(iv + d));
  lo = Math.min(Math.max(lo, min), max);
  hi = Math.min(Math.max(hi, min), max);
  if (hi === lo && hi > 2 && hi < max) hi = lo + 1;
  return [lo, hi];
}

/**
 * A review interval in days, fuzzed as Anki fuzzes it (`with_review_fuzz`): by the load balancer
 * when it has a day for it, else a day in the fuzz range picked by `factor`, else rounded.
 */
export function withReviewFuzz(factor: number | undefined, iv: number, min: number, max: number, balance?: Balancer): number {
  iv = f32(iv);
  const balanced = balance?.(iv, min, max);
  if (balanced !== undefined) return balanced;
  if (factor === undefined) return Math.min(Math.max(roundU32(iv), min), max);
  const [lo, hi] = constrainedFuzzBounds(iv, min, max);
  return asU32(Math.floor(f32(f32(lo) + f32(factor * f32(1 + hi - lo)))));
}

/** FSRS's least interval for a review answer, given the previous one (`minimum_review_fuzz_interval`). */
export function minimumReviewFuzzInterval(iv: number, previous: number, max: number): number {
  const [, hi] = constrainedFuzzBounds(f32(iv), 1, max);
  if (roundU32(f32(iv)) > previous) return previous + 1;
  return previous <= hi ? previous : 0;
}

/** Anki's (min, max) for a review interval: `max` at least 1, `min` within 1..max. */
export function reviewBounds(min: number, maxInterval: number): [number, number] {
  const max = Math.max(maxInterval, 1);
  return [Math.min(Math.max(min, 1), max), max];
}

// ==== load balancer ====

/** Picks a day for an interval, or undefined to fall back to fuzz. */
export type Balancer = (iv: number, min: number, max: number) => number | undefined;

const MAX_LOAD_BALANCE_INTERVAL = 90;
/** How many days ahead the load balancer counts: (90f32 * 1.1) as usize. */
export const LOAD_BALANCE_DAYS = 99;
const SIBLING_PENALTY = [1, 0.8, 0.6, 0.4, 0.2, 0.000001, 0.2, 0.4, 0.6, 0.8, 1].map(f32);
type DayKind = 'normal' | 'minimum' | 'reduced';
const DAY_LOAD: Record<DayKind, number> = { minimum: f32(0.0001), reduced: f32(0.5), normal: f32(1) };
const dayKind = (pct: number): DayKind => (f32(pct) === 1 ? 'normal' : f32(pct) === 0 ? 'minimum' : 'reduced');

export interface BalanceInput {
  seed: bigint;
  /** Cards of the answered card's preset due on each day from today (index 0), LOAD_BALANCE_DAYS long. */
  dayCounts: number[];
  /** The days (from today) holding a card of the same note, any preset, the card itself included; only with "bury review siblings" on. */
  siblingDays?: number[];
  /** The preset's easy days, Monday to Sunday (Anki's easy_days_percentages); empty for none. */
  easyDays?: number[];
  /** The weekday (Monday 0) of day `d` from today. */
  weekdayOf: (d: number) => number;
}

/** The load balancer's day for an interval (`find_interval`), or undefined when it doesn't apply. */
export function balancedInterval(iv: number, min: number, max: number, a: BalanceInput): number | undefined {
  iv = f32(iv);
  if (Math.trunc(iv) > MAX_LOAD_BALANCE_INTERVAL || min > MAX_LOAD_BALANCE_INTERVAL) return undefined;
  const [before, after] = constrainedFuzzBounds(iv, min, max);
  const days = Array.from({ length: after - before + 1 }, (_, i) => before + i);
  const counts = days.map((d) => a.dayCounts[d] ?? 0);

  // Easy days: a reduced day becomes a minimum day when it would otherwise take more than its share.
  const kinds = a.easyDays?.length === 7 ? a.easyDays.map(dayKind) : (Array(7).fill('normal') as DayKind[]);
  const weekdays = days.map(a.weekdayOf);
  const total = counts.reduce((x, y) => x + y, 0);
  let totalPct = f32(0);
  for (const wd of weekdays) totalPct = f32(totalPct + DAY_LOAD[kinds[wd]]);
  const easy = days.map((_, i) => {
    let k = kinds[weekdays[i]];
    if (k === 'reduced') {
      const otherTotal = f32(total - counts[i]);
      const otherPct = f32(totalPct - 0.5);
      const normalized = f32(f32(counts[i]) / f32(0.5));
      const threshold = otherPct !== 0 ? f32(otherTotal / otherPct) : otherTotal > 0 ? Infinity : NaN;
      k = normalized > threshold ? 'minimum' : 'normal';
    }
    return DAY_LOAD[k];
  });

  // Days near a sibling are penalized, the sibling's own day most.
  const sibling = days.map(() => f32(1));
  for (const s of [...new Set(a.siblingDays ?? [])].sort((x, y) => x - y)) {
    for (let k = -5; k <= 5; k++) {
      const t = s + k - before;
      if (t >= 0 && t < sibling.length) sibling[t] = f32(sibling[t] * SIBLING_PENALTY[k + 5]);
    }
  }

  const weights = days.map((d, i) => {
    if (counts[i] === 0) return f32(1);
    const byCount = f32(Math.pow(f32(1 / counts[i]), f32(2.15)));
    const inv = f32(1 / f32(d));
    const byInterval = f32(f32(inv * inv) * inv);
    return f32(f32(f32(byCount * byInterval) * sibling[i]) * easy[i]);
  });

  // rand's WeightedIndex<f32>: cumulative weights, and the first whose running total passes the draw.
  let sum = weights[0];
  const cumulative: number[] = [];
  for (const w of weights.slice(1)) { cumulative.push(sum); sum = f32(sum + w); }
  if (sum === 0) return undefined;
  let scale = sum;
  const maxRand = f32(1 - 2 ** -23);
  const buf = new DataView(new ArrayBuffer(4));
  while (f32(f32(scale * maxRand) + 0) > sum) {
    buf.setFloat32(0, scale);
    buf.setUint32(0, buf.getUint32(0) - 1);
    scale = buf.getFloat32(0);
  }
  const chosen = f32(f32(fuzzFactor(a.seed) * scale) + 0);
  return days[cumulative.filter((c) => c <= chosen).length];
}

// ==== FSRS answers ====

/**
 * A review card's Hard, Good and Easy intervals under FSRS (rslib states/review.rs): each fuzzed
 * at least past the last, and past the card's previous interval when FSRS's own is longer.
 */
export function fsrsReviewDays(
  raw: [number, number, number], previousIvl: number, maxInterval: number, factor: number | undefined, balance?: Balancer,
): [number, number, number] {
  const fuzz = (iv: number, least: number) => {
    const [min, max] = reviewBounds(least, maxInterval);
    return withReviewFuzz(factor, iv, min, max, balance);
  };
  const hard = fuzz(raw[0], Math.max(minimumReviewFuzzInterval(raw[0], previousIvl, maxInterval), 1));
  const good = fuzz(raw[1], Math.max(minimumReviewFuzzInterval(raw[1], previousIvl, maxInterval), hard + 1));
  const easy = fuzz(raw[2], Math.max(minimumReviewFuzzInterval(raw[2], previousIvl, maxInterval), good + 1));
  return [hard, good, easy];
}

/**
 * The interval a card graduates from learning or relearning with under FSRS (states/learning.rs,
 * relearning.rs): the rating's interval rounded and fuzzed, and for Easy, past Good's.
 */
export function fsrsGraduatingDays(
  rating: 1 | 2 | 3 | 4, raw: { chosen: number; good: number }, maxInterval: number, factor: number | undefined, balance?: Balancer,
): number {
  const fuzz = (iv: number, least: number) => {
    const [min, max] = reviewBounds(least, maxInterval);
    return withReviewFuzz(factor, iv, min, max, balance);
  };
  const rounded = (iv: number) => Math.max(roundU32(f32(iv)), 1);
  if (rating !== 4) return fuzz(rounded(raw.chosen), 1);
  const good = fuzz(raw.good, 1);
  return fuzz(rounded(raw.chosen), good + 1);
}
