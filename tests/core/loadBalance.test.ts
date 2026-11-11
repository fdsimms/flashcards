import { describe, expect, it } from 'vitest';
import { fsrsReviewDays, fuzzFactor } from '../../src/core/ankiFuzz';
import { makeCards } from '../../src/core/cards';
import { balancerFor, buildLoadSnapshot, forgetCard, loadDayIndex, recordAnswer } from '../../src/core/loadBalance';
import type { Card } from '../../src/core/types';
import vectors from '../fixtures/anki/fuzz-vectors.json';
import { NOW, omniNote } from '../support/fixtures';

const H = 4;
const [base] = makeCards(omniNote(), NOW);
let n = 0;
const reviewOn = (day: number, noteId = `n${n++}`): Card =>
  ({ ...base, id: `c${n++}`, noteId, sched: { ...base.sched, state: 2, due: new Date(2026, 10, 11 + day, 9).toISOString() } });

describe("the load balancer's snapshot", () => {
  it("reads days as Anki's query does: new cards by position, nothing in a filtered deck", () => {
    expect(loadDayIndex(reviewOn(3), NOW, H, 0)).toBe(3);
    expect(loadDayIndex({ ...base, position: 5 }, NOW, H, 2)).toBe(3);
    expect(loadDayIndex({ ...reviewOn(3), filteredDeck: 'Cram' }, NOW, H, 0)).toBeUndefined();
    expect(loadDayIndex(reviewOn(120), NOW, H, 0)).toBeUndefined();
  });

  it('adds an answered card at its new interval, and takes an undone one out', () => {
    const card = reviewOn(0);
    const snap = buildLoadSnapshot([card, reviewOn(2)], () => 1, (c) => loadDayIndex(c, NOW, H, 0));
    recordAnswer(snap, card, 1, 5);
    expect(snap.get(card.id)!.days).toEqual([0, 5]);
    forgetCard(snap, card.id);
    expect(snap.has(card.id)).toBe(false);
  });

  it("balances as Anki did, from a snapshot of the same cards (preset B: easy days, buried siblings)", () => {
    const v = vectors.anki_fsrs_review_lb_off_on;
    const weekdayOf = (d: number) => (v.weekday_of_day1 + d - 1 + 70) % 7;
    for (const r of v.lb_on.filter((x) => x.preset === 'B')) {
      // The answered card today and its sibling in 8 days share a note; other cards fill each day's count.
      const card = reviewOn(0, 'note');
      const cards = [card, reviewOn(8, 'note')];
      v.countsB.forEach((count, d) => {
        const own = (d === 0 ? 1 : 0) + (d === 8 ? 1 : 0);
        for (let i = own; i < count; i++) cards.push(reviewOn(d));
      });
      const snap = buildLoadSnapshot(cards, () => 2, (c) => loadDayIndex(c, NOW, H, 0));
      const balance = balancerFor(snap, card, {
        preset: 2, seed: BigInt(r.seed), easyDays: [1, 1, 1, 1, 1, 0.5, 0], buryReviews: true, nextDayAt: NOW, weekdayOf,
      });
      const raw = r.raw_interval_hge_approx as [number, number, number];
      expect(fsrsReviewDays(raw, r.ivl, 36500, fuzzFactor(BigInt(r.seed)), balance)).toEqual(r.got_hge);
    }
  });

  it('leaves plain fuzz to a preset with no cards in the window', () => {
    const card = reviewOn(0);
    expect(balancerFor(new Map(), card, { preset: 1, seed: 1n, buryReviews: false, nextDayAt: NOW })).toBeUndefined();
  });
});
