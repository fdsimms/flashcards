import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN_PREFS, EMPTY_PLAN_STATE, dayNumberOf, outcomeOf, parsePlanPrefs, parsePlanState, pickLanguage, planDay, recordDay, recordPlanDone, weekDots, withDone,
  type PlanOffer, type PlanPrefs,
} from '../../src/tools/plan';

const prefs = (over: Partial<PlanPrefs> = {}): PlanPrefs => ({ ...DEFAULT_PLAN_PREFS, ...over });
const OFFER: PlanOffer = {
  due: 64, fresh: 10,
  read: { title: 'Na targu', minutes: 6, coverage: 0.94 },
  watch: { id: 7, title: 'W kawiarni', minutes: 12, what: 'podcast' },
  listen: { words: 30, minutes: 9 },
  drill: { tool: 'cases', title: 'Which case', missed: true },
  speak: true, write: true,
};

describe("Today's plan", () => {
  it('plans reviews first, then new words, one thing to take in and one to produce', () => {
    const items = planDay(prefs(), OFFER, 0);
    expect(items.map((i) => [i.kind, i.minutes])).toEqual([['reviews', 9], ['new', 4], ['read', 6], ['drill', 3]]);
    expect(items[0].detail).toBe('64 cards');
    expect(items[3]).toMatchObject({ title: 'Practice: Which case', detail: 'You missed some lately', ref: 'cases' });
  });

  it('is reviews alone when they fill the time, and new words wait', () => {
    expect(planDay(prefs({ minutes: 15 }), { ...OFFER, due: 200 }, 0).map((i) => i.kind)).toEqual(['reviews']);
    const tight = planDay(prefs({ minutes: 15 }), { ...OFFER, due: 90 }, 0);
    expect(tight[1]).toMatchObject({ kind: 'new', detail: '9 of 10 left today' });
  });

  it("takes turns day by day with what's on offer and turned on", () => {
    const takeIn = (day: number, p = prefs()) => planDay(p, { ...OFFER, due: 0, fresh: 0 }, day).find((i) => ['read', 'watch', 'listen'].includes(i.kind))?.kind;
    expect([0, 1, 2, 3].map((d) => takeIn(d))).toEqual(['read', 'watch', 'listen', 'read']);
    expect(takeIn(0, prefs({ kinds: { ...DEFAULT_PLAN_PREFS.kinds, read: false } }))).toBe('watch');
    const produce = (day: number) => planDay(prefs(), { ...OFFER, due: 0, fresh: 0, drill: { tool: 'counting', title: 'Counting', missed: false } }, day).at(-1)?.kind;
    expect([0, 1, 2].map(produce)).toEqual(['drill', 'speak', 'write']);
    // Nothing on offer for a kind: it isn't planned.
    expect(planDay(prefs(), { due: 0, fresh: 0 }, 0)).toEqual([]);
    expect(planDay(prefs(), { due: 0, fresh: 0, watch: OFFER.watch }, 0)[0].title).toBe('Listen: W kawiarni');
  });

  it('picks the chosen language, else the one with the most to do', () => {
    const languages = [{ language: 'th' as const, due: 10, fresh: 5 }, { language: 'pl' as const, due: 40, fresh: 0 }];
    expect(pickLanguage(prefs(), languages)).toBe('pl');
    expect(pickLanguage(prefs({ language: 'th' }), languages)).toBe('th');
    expect(pickLanguage(prefs({ language: 'ja' }), languages)).toBe('pl');
    expect(pickLanguage(prefs(), [])).toBeNull();
  });

  it('marks what is done, and the day as all or part done', () => {
    const items = planDay(prefs(), OFFER, 0);
    const { items: marked, doneMinutes } = withDone(items, (k) => k === 'reviews' || k === 'new');
    expect(doneMinutes).toBe(13);
    expect(outcomeOf(marked)).toBe('part');
    expect(outcomeOf(marked.map((i) => ({ ...i, done: true })))).toBe('all');
    expect(outcomeOf(items)).toBeNull();
  });

  it('keeps a fortnight of days, and what was done, readably', () => {
    let state = EMPTY_PLAN_STATE;
    for (let d = 1; d <= 20; d++) state = recordDay(state, `2026-11-${String(d).padStart(2, '0')}`, d % 2 ? 'all' : 'part');
    expect(Object.keys(state.days)).toHaveLength(14);
    state = recordDay(state, '2026-11-20', null);
    expect(state.days['2026-11-20']).toBeUndefined();
    state = recordPlanDone(state, 'speak', 'pl', 99);
    const saved = { day: '2026-11-28', language: 'pl', minutes: 30, items: [{ kind: 'reviews', title: 'Reviews', detail: '3 cards', minutes: 1 }, { kind: 'bogus' }] };
    const back = parsePlanState(JSON.stringify({ ...state, saved }));
    expect(back.done).toEqual({ 'speak|pl': 99 });
    expect(back.saved?.items).toEqual([{ kind: 'reviews', title: 'Reviews', detail: '3 cards', minutes: 1 }]);
    expect(parsePlanState('nope')).toEqual(EMPTY_PLAN_STATE);
    expect(parsePlanPrefs(JSON.stringify({ minutes: 45, language: 'pl', kinds: { speak: false } }))).toEqual({ ...DEFAULT_PLAN_PREFS, minutes: 45, language: 'pl', kinds: { ...DEFAULT_PLAN_PREFS.kinds, speak: false } });
    expect(parsePlanPrefs(JSON.stringify({ minutes: 7 })).minutes).toBe(30);
  });

  it("shows the week's last seven study days, and counts days across a change of clocks", () => {
    const dots = weekDots({ ...EMPTY_PLAN_STATE, days: { '2026-11-27': 'all', '2026-11-25': 'part' } }, '2026-11-28');
    expect(dots.map((d) => d.letter).join('')).toBe('SMTWTFS');
    expect(dots.map((d) => d.outcome)).toEqual([null, null, null, 'part', null, 'all', null]);
    expect(dayNumberOf('2026-03-30') - dayNumberOf('2026-03-28')).toBe(2);
  });
});
