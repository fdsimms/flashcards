import { describe, expect, it } from 'vitest';
import { makeCards } from '../../src/core/cards';
import { becameLeech, daysSinceLastReview, formatInterval, paramsForDeck, previewIntervals, rawInterval, review, newSchedState, stepOutcome, type RatingValue } from '../../src/core/scheduler';
import { fuzzSeed } from '../../src/core/ankiFuzz';
import { studyDayKey, studyDayStart } from '../../src/core/day';
import { isInterdayLearning } from '../../src/core/queue';
import { retrievability } from '../../src/core/order';
import type { DeckParams } from '../../src/core/types';
import answerVectors from '../fixtures/anki/answer-vectors.json';
import { NOW, omniNote } from '../support/fixtures';

describe('scheduler', () => {
  it("shortens a review's interval to a cram's day (capDays), and only ever shortens it", () => {
    const [card] = makeCards(omniNote(), NOW);
    const sched = { ...card.sched, state: 2, stability: 40, difficulty: 5, reps: 5, scheduledDays: 30, lastReview: new Date(2026, 9, 12, 12).toISOString() };
    const free = review(sched, 3, NOW);
    expect(free.sched.scheduledDays).toBeGreaterThan(2);
    const capped = review(sched, 3, NOW, undefined, { capDays: 2 });
    expect(capped.sched.scheduledDays).toBe(2);
    expect(studyDayKey(new Date(capped.sched.due), 4)).toBe('2026-11-13');
    expect(capped.log.due).toBe(capped.sched.due);
    expect(capped.sched.stability).toBe(free.sched.stability);
    expect(previewIntervals(sched, NOW, undefined, { capDays: 2 })[3]).toBe('2d');
    // A cap past the interval changes nothing; a cap of 0 (the day itself) is ignored.
    expect(review(sched, 3, NOW, undefined, { capDays: 9999 }).sched.due).toBe(free.sched.due);
    expect(review(sched, 3, NOW, undefined, { capDays: 0 }).sched.due).toBe(free.sched.due);
    // A learning step isn't a review interval: Again still waits on its step.
    expect(review(sched, 1, NOW, undefined, { capDays: 2 }).sched.state).toBe(3);
  });
  it('brings a day-long learning step back to the cram day too', () => {
    const [card] = makeCards(omniNote(), NOW);
    const params: DeckParams = { weights: [], desiredRetention: 0.9, maxInterval: 36500, learnSteps: [1, 4 * 1440] };
    const free = review(card.sched, 3, NOW, params, { dayStartsAtHour: 4 });
    expect(studyDayKey(new Date(free.sched.due), 4)).toBe('2026-11-15');
    const capped = review(card.sched, 3, NOW, params, { dayStartsAtHour: 4, capDays: 2 });
    expect(capped.sched.state).toBe(1);
    expect(studyDayKey(new Date(capped.sched.due), 4)).toBe('2026-11-13');
  });

  it('moves a new card forward and spaces Good further than Again', () => {
    const [card] = makeCards(omniNote(), NOW);
    const good = review(card.sched, 3, NOW);
    const again = review(card.sched, 1, NOW);
    expect(good.sched.reps).toBe(1);
    expect(new Date(good.sched.due).getTime()).toBeGreaterThan(new Date(again.sched.due).getTime());
    expect(good.log.rating).toBe(3);
    const preview = previewIntervals(card.sched, NOW);
    expect(Object.keys(preview)).toHaveLength(4);
  });
  it('logs the state the card was in before the answer', () => {
    // studiedToday counts a card as introduced by a log with state 0, so this is load-bearing.
    const [card] = makeCards(omniNote(), NOW);
    const first = review(card.sched, 3, NOW);
    expect(first.log.state).toBe(0);
    expect(review(first.sched, 3, NOW).log.state).not.toBe(0);
  });

  it("uses a deck's retention: lower retention spaces a review further out", () => {
    const [card] = makeCards(omniNote(), NOW);
    const learned = review(review(card.sched, 3, NOW).sched, 3, new Date(2026, 10, 12, 12)).sched;
    const at = new Date(2026, 10, 20, 12);
    const strict = review(learned, 3, at, { weights: [], desiredRetention: 0.95, maxInterval: 36500 });
    const loose = review(learned, 3, at, { weights: [], desiredRetention: 0.8, maxInterval: 36500 });
    expect(loose.sched.scheduledDays).toBeGreaterThan(strict.sched.scheduledDays);
  });
  it('accepts FSRS-5 (19) and FSRS-6 (21) weights', () => {
    const [card] = makeCards(omniNote(), NOW);
    const w19 = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
    const w21 = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
    for (const weights of [w19, w21]) {
      expect(review(card.sched, 4, NOW, { weights, desiredRetention: 0.9, maxInterval: 36500 }).sched.stability).toBeGreaterThan(0);
    }
  });
  it("falls back to the nearest ancestor deck's settings", () => {
    const thai: DeckParams = { weights: [], desiredRetention: 0.9, maxInterval: 36500 };
    const langs: DeckParams = { weights: [], desiredRetention: 0.8, maxInterval: 36500 };
    const all = new Map([['Languages::Thai', thai], ['Languages', langs]]);
    expect(paramsForDeck('Languages::Thai::Consonants', all)).toBe(thai);
    expect(paramsForDeck('Languages::Polish', all)).toBe(langs);
    expect(paramsForDeck('Trivia', all)).toBeUndefined();
  });
  it('schedules from countFrom when a lookalike was seen since the last review: a smaller step than the whole interval', () => {
    const [card] = makeCards(omniNote(), NOW);
    let s = review(card.sched, 3, NOW).sched;
    s = review(s, 3, new Date(2026, 10, 12, 12)).sched;
    s = review(s, 3, new Date(2026, 10, 20, 12)).sched;
    const at = new Date(2026, 11, 20, 12);
    const plain = review(s, 3, at).sched;
    const reminded = review(s, 3, at, undefined, { countFrom: new Date(2026, 11, 19, 12) }).sched;
    expect(reminded.stability).toBeLessThan(plain.stability);
    expect(new Date(reminded.due).getTime()).toBeLessThan(new Date(plain.due).getTime());
    // The card still records the real review time as its last review.
    expect(reminded.lastReview).toBe(at.toISOString());
    expect(previewIntervals(s, at, undefined, { countFrom: new Date(2026, 11, 19, 12) })[3]).not.toBe(previewIntervals(s, at)[3]);
  });
  it('ignores a countFrom before the last review', () => {
    const [card] = makeCards(omniNote(), NOW);
    const s = review(card.sched, 3, NOW).sched;
    const at = new Date(2026, 10, 14, 12);
    expect(review(s, 3, at, undefined, { countFrom: new Date(2026, 10, 1) }).sched.stability).toBe(review(s, 3, at).sched.stability);
  });
});

describe('across a DST change', () => {
  // North American DST ends on Nov 1 2026; `npm run test:tz` runs this in Newfoundland, which has it.
  const days = (from: Date, to: Date) => {
    const [a, b] = [studyDayKey(from, 4), studyDayKey(to, 4)].map((k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)));
    return Math.round((b - a) / 86400000);
  };

  it('lands a review on the study day its interval says, not an hour into the one before', () => {
    const [card] = makeCards(omniNote(), NOW);
    const now = new Date(2026, 9, 31, 4, 30);
    const sched = { ...card.sched, state: 2, stability: 5, difficulty: 5, reps: 3, scheduledDays: 4,
      lastReview: new Date(2026, 9, 27, 12).toISOString(), due: new Date(2026, 9, 31, 12).toISOString() };
    const next = review(sched, 3, now, undefined, { dayStartsAtHour: 4 }).sched;
    expect(next.scheduledDays).toBeGreaterThan(1);
    expect(days(now, new Date(next.due))).toBe(next.scheduledDays);
  });

  it('starts a day-long learning step at the start of the day it lands on', () => {
    const [card] = makeCards(omniNote(), NOW);
    const params = { learnSteps: [1, 2880], relearnSteps: [10], weights: [], desiredRetention: 0.9, maxInterval: 36500 } as unknown as DeckParams;
    const now = new Date(2026, 9, 30, 12);
    // Good on a new card moves it to the second step, two days out.
    const next = review(card.sched, 3, now, params, { dayStartsAtHour: 4 }).sched;
    expect(studyDayKey(new Date(next.due), 4)).toBe('2026-11-01');
    expect(new Date(next.due).getHours()).toBe(4);
  });
});

describe("Anki's learning steps", () => {
  const at = new Date(2026, 10, 11, 12, 0);
  const mins = (s: { due: string }) => Math.round((new Date(s.due).getTime() - at.getTime()) / 60000);
  const p = (learnSteps: number[], relearnSteps: number[] = [10]) => ({ weights: [], desiredRetention: 0.9, maxInterval: 36500, learnSteps, relearnSteps });

  it('waits on each step, with Hard between the first two and repeating a later one', () => {
    const fresh = newSchedState(at);
    expect(stepOutcome([1, 10], 0, 2)).toEqual({ secs: 330, index: 0 });
    expect(stepOutcome([1], 0, 2)).toEqual({ secs: 90, index: 0 });
    expect(stepOutcome([1, 10, 60], 1, 2)).toEqual({ secs: 600, index: 1 });
    expect(stepOutcome([1, 10], 1, 3)).toBe('graduate');
    const good = review(fresh, 3, at, p([1, 10, 60])).sched;
    expect([good.state, good.learningSteps, mins(good)]).toEqual([1, 1, 10]);
    const hard = review({ ...good, due: at.toISOString() }, 2, at, p([1, 10, 60])).sched;
    expect([hard.state, hard.learningSteps, mins(hard)]).toEqual([1, 1, 10]);
    expect(review(fresh, 4, at, p([1, 10])).sched.state).toBe(2);
  });

  it('keeps a card on a step of a day or more in learning, where ts-fsrs would graduate it', () => {
    const second = review(newSchedState(at), 3, at, p([10, 1440])).sched;
    // As in Anki, a step crossing into a later day is due from the start of that study day (4 AM tomorrow).
    expect([second.state, second.learningSteps, second.due]).toEqual([1, 1, new Date(2026, 10, 12, 4, 0).toISOString()]);
  });

  it('relearns a forgotten review on the relearning steps, or keeps it a review without any', () => {
    const graduated = review(newSchedState(at), 4, at).sched;
    const later = new Date(at.getTime() + 30 * 86400000);
    const lapsed = review(graduated, 1, later, p([1, 10], [5, 30])).sched;
    expect([lapsed.state, lapsed.learningSteps, lapsed.lapses]).toEqual([3, 0, 1]);
    expect(review(graduated, 1, later, p([1, 10], [])).sched.state).toBe(2);
  });
});

describe('leeches', () => {
  const at = new Date(2026, 10, 11, 12, 0);
  const reviewWith = (lapses: number) => ({ ...newSchedState(at), state: 2, lapses, stability: 5, difficulty: 5, scheduledDays: 20, lastReview: new Date(2026, 9, 1).toISOString() });
  it("becomes a leech on the lapse that reaches the threshold, then every half-threshold, as in Anki", () => {
    const lapse = (lapses: number) => review(reviewWith(lapses), 1, at).sched;
    expect(becameLeech(reviewWith(6), lapse(6))).toBe(false);
    expect(becameLeech(reviewWith(7), lapse(7))).toBe(true); // the 8th lapse
    expect(becameLeech(reviewWith(8), lapse(8))).toBe(false);
    expect(becameLeech(reviewWith(11), lapse(11))).toBe(true); // the 12th
    expect(becameLeech(reviewWith(3), lapse(3), { threshold: 4 })).toBe(true);
    expect(becameLeech(reviewWith(7), lapse(7), { threshold: 0 })).toBe(false);
  });
  it('only counts a forgotten review, not a learning step', () => {
    const learning = { ...reviewWith(7), state: 1 };
    expect(becameLeech(learning, review(learning, 1, at).sched)).toBe(false);
    expect(becameLeech(reviewWith(7), review(reviewWith(7), 3, at).sched)).toBe(false);
  });
});

describe('the days FSRS counts since the last answer', () => {
  it("counts to the end of today's study day in 24-hour blocks, as Anki does", () => {
    const last = new Date(2026, 0, 10, 23, 0);
    // The same study day, across midnight: no days, whatever the calendar or the UTC date says.
    expect(daysSinceLastReview(last, new Date(2026, 0, 10, 23, 10), 4)).toBe(0);
    expect(daysSinceLastReview(last, new Date(2026, 0, 11, 3, 59), 4)).toBe(0);
    expect(daysSinceLastReview(last, new Date(2026, 0, 11, 4, 1), 4)).toBe(1);
    // 1 AM two nights later is still the next study day.
    expect(daysSinceLastReview(last, new Date(2026, 0, 12, 1, 0), 4)).toBe(1);
    expect(daysSinceLastReview(last, new Date(2026, 0, 12, 4, 0), 4)).toBe(2);
    // With the day starting at midnight, 23:00 to 00:10 is a day.
    expect(daysSinceLastReview(last, new Date(2026, 0, 11, 0, 10), 0)).toBe(1);
    // A last answer in the future (a clock set back) is no days, not a negative count.
    expect(daysSinceLastReview(new Date(2026, 0, 20, 12), new Date(2026, 0, 11, 12), 4)).toBe(0);
  });
  it('gives two answers in one study day the same memory state at any hour, so in any time zone', () => {
    // Good, then Good ten minutes later, started at each hour: one of them crosses UTC midnight
    // wherever the suite runs, which ts-fsrs alone counts as a day between the two.
    const outcomes = new Set<string>();
    for (let hour = 5; hour < 27; hour++) {
      const first = new Date(2026, 0, 10, hour, 55);
      const learning = review(newSchedState(first), 3, first, undefined, { dayStartsAtHour: 4 }).sched;
      const second = review(learning, 3, new Date(2026, 0, 10, hour + 1, 5), undefined, { dayStartsAtHour: 4 }).sched;
      outcomes.add(`${second.stability} ${second.difficulty} ${second.scheduledDays} ${second.elapsedDays}`);
    }
    expect([...outcomes]).toHaveLength(1);
  });
});

/**
 * Each scenario is a card answered in Anki itself at set times (make-answer-vectors.py), replayed
 * here at the same wall-clock times. A scenario recorded in a zone (it crosses a daylight saving
 * change there) runs only in that zone: `npm run test:tz` has it.
 */
describe(`answers scheduled as Anki ${answerVectors.anki} schedules them (tests/fixtures/anki/answer-vectors.json)`, () => {
  interface Scenario {
    name: string; tz?: string; cardId: string; rollover?: number; learn?: number[]; relearn?: number[]; retention?: number; weights?: number[]; maxInterval?: number;
    answers: { at: string; rating: number; type: number; queue: number; dueInSecs?: number; dueInDays?: number; interval: number; stepsLeft: number; reps: number; lapses: number; stability: number; difficulty: number }[];
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [card] = makeCards(omniNote(), NOW);
  for (const sc of answerVectors.scenarios as Scenario[]) {
    it.runIf(!sc.tz || sc.tz === zone)(sc.name, () => {
      const h = sc.rollover ?? 4;
      const learnSteps = sc.learn ?? [1, 10];
      const relearnSteps = sc.relearn ?? [10];
      const params: DeckParams = { weights: sc.weights ?? [], desiredRetention: sc.retention ?? 0.9, maxInterval: sc.maxInterval ?? 36500, learnSteps, relearnSteps };
      /** The study day a moment falls in, as a day number. */
      const dayOf = (d: Date) => { const s = studyDayStart(d, h); return Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()) / 86400000; };
      let sched = newSchedState(new Date(sc.answers[0].at));
      for (const a of sc.answers) {
        const now = new Date(a.at);
        const at = `${a.at} rated ${a.rating}`;
        sched = review(sched, a.rating as RatingValue, now, params, { seed: fuzzSeed(sc.cardId, sched.reps), dayStartsAtHour: h }).sched;
        expect(sched.state, at).toBe(a.type);
        expect([sched.reps, sched.lapses], at).toEqual([a.reps, a.lapses]);
        // Anki works in f32 and keeps four decimals; ts-fsrs in doubles.
        expect(Math.abs(sched.stability - a.stability) / a.stability, `${at}: stability ${sched.stability}, Anki's ${a.stability}`).toBeLessThan(2e-4);
        expect(Math.abs(sched.difficulty - a.difficulty), `${at}: difficulty ${sched.difficulty}, Anki's ${a.difficulty}`).toBeLessThan(2e-3);
        const due = new Date(sched.due);
        if (a.queue === 1) {
          // A step within the day: due at its instant, fuzzed as Anki fuzzed it.
          expect(Math.round((due.getTime() - now.getTime()) / 1000), at).toBe(a.dueInSecs);
          expect(isInterdayLearning({ ...card, sched }, h), at).toBe(false);
        } else {
          expect(dayOf(due) - dayOf(now), at).toBe(a.dueInDays);
          // Anki's queue 3: a learning card due on a later day.
          expect(isInterdayLearning({ ...card, sched }, h), at).toBe(a.queue === 3);
        }
        if (a.type === 2) expect(sched.scheduledDays, at).toBe(a.interval);
        else expect(sched.learningSteps, at).toBe((a.type === 3 ? relearnSteps : learnSteps).length - a.stepsLeft);
        // A relearning card keeps the interval its lapse gave it; a learning card has none.
        if (a.type !== 2) expect(sched.scheduledDays, at).toBe(a.interval);
      }
    });
  }
});

describe('formatInterval', () => {
  const MIN = 60000;
  it('moves to the next unit when the rounded value reaches it', () => {
    expect(formatInterval(59.7 * MIN)).toBe('1h');
    expect(formatInterval(23.7 * 60 * MIN)).toBe('1d');
    expect(formatInterval(29.7 * 1440 * MIN)).toBe('1mo');
    expect(formatInterval(364.9 * 1440 * MIN)).toBe('1y');
  });
  it('keeps the smaller unit below the boundary', () => {
    expect(formatInterval(59.2 * MIN)).toBe('59m');
    expect(formatInterval(23.2 * 60 * MIN)).toBe('23h');
    expect(formatInterval(45 * 1440 * MIN)).toBe('1.5mo');
  });
});

describe('weights from before FSRS-6', () => {
  // FSRS-4.5 and FSRS-5 weights have no decay of their own: theirs is 0.5, as Anki and ts-fsrs's migration use.
  const fsrs5 = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];

  it('times an interval with a decay of 0.5', () => {
    // With decay 0.5 the interval is S / factor * (r^-2 - 1), factor = 0.9^-2 - 1 = 19/81.
    for (const r of [0.8, 0.85, 0.9, 0.95]) {
      const want = 10 / (19 / 81) * (Math.pow(r, -2) - 1);
      expect(rawInterval(10, r, fsrs5)).toBeCloseTo(want, 3);
      expect(rawInterval(10, r, fsrs5.slice(0, 17))).toBeCloseTo(want, 3);
    }
  });

  it('gives a retrievability, never NaN', () => {
    const [c] = makeCards(omniNote(), NOW);
    const reviewed = { ...c, sched: { ...c.sched, state: 2 as const, stability: 10, lastReview: new Date(NOW.getTime() - 10 * 86_400_000).toISOString() } };
    // At t = S, recall is 0.9 under every FSRS version.
    expect(retrievability(reviewed, NOW, fsrs5)).toBeCloseTo(0.9, 5);
    expect(retrievability({ ...reviewed, sched: { ...reviewed.sched, lastReview: new Date(NOW.getTime() - 30 * 86_400_000).toISOString() } }, NOW, fsrs5))
      .toBeCloseTo(1 / Math.sqrt(1 + (19 / 81) * 3), 5);
  });
});
