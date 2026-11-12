import { describe, expect, it } from 'vitest';
import {
  balancedInterval, fsrsGraduatingDays, fsrsReviewDays, fuzzFactor, learningStepWithFuzz, stdRngBlock, type Balancer,
} from '../../src/core/ankiFuzz';
import vectors from '../fixtures/anki/fuzz-vectors.json';

/** Outputs recorded from the real `anki` 26.09.4 package (tests/fixtures/anki/fuzz-vectors.json). */
describe("Anki's fuzz and load balancer, against Anki's own outputs", () => {
  it("reproduces Rust's StdRng: its first words and Anki's fuzz factor", () => {
    for (const r of vectors.rng) {
      expect(stdRngBlock(BigInt(r.seed)).slice(0, 4)).toEqual(r.first_u32);
      expect(fuzzFactor(BigInt(r.seed))).toBe(r.fuzz_factor);
    }
  });

  it('fuzzes learning steps as Anki did, card by card', () => {
    for (const r of vectors.learning_fuzz) expect(learningStepWithFuzz(BigInt(r.seed), r.secs)).toBe(r.result);
    for (const r of [...vectors.anki_learn_and_sm2.learn, ...vectors.anki_graduation_relearn.relearn]) {
      expect(learningStepWithFuzz(BigInt(r.seed), r.step_secs) - r.step_secs).toBe(r.offset);
    }
  });

  it('fuzzes FSRS review intervals as Anki did, load balancer off', () => {
    for (const r of vectors.anki_fsrs_review_lb_off_on.lb_off) {
      const raw = r.raw_interval_hge_approx as [number, number, number];
      expect(fsrsReviewDays(raw, r.ivl, 36500, fuzzFactor(BigInt(r.seed)))).toEqual(r.got_hge);
    }
  });

  it('balances FSRS review intervals as Anki did, with easy days and siblings', () => {
    const v = vectors.anki_fsrs_review_lb_off_on;
    // Day 1 fell on a Thursday (Monday 0) in that run.
    const weekdayOf = (d: number) => (v.weekday_of_day1 + d - 1 + 70) % 7;
    for (const r of v.lb_on) {
      const b = r.preset === 'B';
      const balance: Balancer = (iv, min, max) => balancedInterval(iv, min, max, {
        seed: BigInt(r.seed), dayCounts: b ? v.countsB : v.countsA, weekdayOf,
        // Preset B buries review siblings (the card itself today, its sibling in 8 days) and has easy days.
        siblingDays: b ? [0, 8] : undefined, easyDays: b ? [1, 1, 1, 1, 1, 0.5, 0] : undefined,
      });
      const raw = r.raw_interval_hge_approx as [number, number, number];
      expect(fsrsReviewDays(raw, r.ivl, 36500, fuzzFactor(BigInt(r.seed)), balance)).toEqual(r.got_hge);
    }
  });

  it('graduates a new card answered Easy past Good, as Anki did', () => {
    for (const r of vectors.anki_graduation_relearn.rows.filter((x) => x.path === 'new->Easy')) {
      expect(fsrsGraduatingDays(4, { chosen: r.easy_raw!, good: r.good_raw! }, 36500, fuzzFactor(BigInt(r.seed)))).toBe(r.got);
    }
  });
});
