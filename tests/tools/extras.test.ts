import { describe, expect, it } from 'vitest';
import { DEFAULT_EXTRA_PREFS, EXTRA_ANSWERS, isDone, lastPracticed, parseExtraPrefs, parseExtraState, planExtras, recordAnswer, recordRead, turnOrder, EMPTY_EXTRA_STATE, type ExtraPrefs, type ExtraState, type PlanInput, extraDrillNames } from '../../src/tools/extras';
import { recordMark } from '../../src/tools/marks';

// A Saturday at noon, local time, with the study day starting at 4 AM.
const NOW = new Date(2026, 10, 14, 12);
const START = new Date(2026, 10, 14, 4).getTime();
const DAY = 24 * 60 * 60 * 1000;

const ALL = ['th', 'es', 'el', 'nb', 'ru'] as const;

function input(over: Partial<Omit<PlanInput, 'prefs'>> & { prefs?: Partial<ExtraPrefs> } = {}): PlanInput {
  const { prefs, ...rest } = over;
  return { prefs: { ...DEFAULT_EXTRA_PREFS, ...prefs }, state: EMPTY_EXTRA_STATE, languages: [...ALL], readerOn: true, marks: {}, now: NOW, dayStartsAtHour: 4, ...rest };
}

describe('planExtras', () => {
  it('gives a focus language two extras and one language a turn', () => {
    const plan = planExtras(input({ prefs: { modes: { th: 'always' } } }));
    expect(plan.extras.filter((e) => e.language === 'th')).toHaveLength(2);
    expect(plan.extras.filter((e) => e.why === 'turn')).toHaveLength(1);
    expect(plan.extras.every((e) => e.why === 'focus' || e.language !== 'th')).toBe(true);
  });

  it('offers a drill and then a text for a focus language', () => {
    const [first, second] = planExtras(input({ prefs: { modes: { th: 'always' } } })).extras;
    expect(first.kind).not.toBe('read');
    expect(second.kind).toBe('read');
  });

  it('offers the drill missed most lately first', () => {
    let marks = recordMark({}, 'script:th', ['ก'], false, NOW.getTime());
    marks = recordMark(marks, 'script:th', ['ก'], false, NOW.getTime());
    marks = recordMark(marks, 'counting:th', ['คน'], false, NOW.getTime());
    const plan = planExtras(input({ prefs: { modes: { th: 'always' } }, marks }));
    expect(plan.extras[0]).toEqual({ language: 'th', kind: 'script', why: 'focus' });
  });

  it('offers Writing by hand once it is the drill missed most', () => {
    const marks = recordMark({}, 'writing:th', ['letter:ข'], false, NOW.getTime());
    const plan = planExtras(input({ prefs: { modes: { th: 'always' } }, marks }));
    expect(plan.extras[0]).toEqual({ language: 'th', kind: 'writing', why: 'focus' });
  });

  it('never offers a drill the language has no version of', () => {
    // Counting things has no Spanish version; Reading the script and Writing by hand have none either.
    for (let day = 0; day < 20; day++) {
      const plan = planExtras(input({ prefs: { modes: { es: 'always' } }, now: new Date(2026, 10, 1 + day, 12) }));
      for (const e of plan.extras.filter((x) => x.language === 'es')) expect(['counting', 'script', 'writing']).not.toContain(e.kind);
    }
  });

  it('takes the language practiced longest ago for a turn, never practiced first', () => {
    let state: ExtraState = recordRead(EMPTY_EXTRA_STATE, 'th', NOW.getTime() - 5 * DAY);
    state = recordRead(state, 'es', NOW.getTime() - 2 * DAY);
    state = recordAnswer(state, 'numbers', 'el', NOW.getTime() - DAY);
    expect(turnOrder(input({ state }))).toEqual(['nb', 'ru', 'th', 'es', 'el']);
    expect(planExtras(input({ state })).extras.map((e) => e.language)).toEqual(['nb']);
  });

  it('offers the same language again when its turn went unused', () => {
    const today = planExtras(input());
    const tomorrow = planExtras(input({ now: new Date(2026, 10, 15, 12), state: { ...EMPTY_EXTRA_STATE } }));
    expect(tomorrow.extras[0].language).toBe(today.extras[0].language);
  });

  it('moves on to the next language once the turn was used', () => {
    const first = planExtras(input()).extras[0].language;
    const state = recordRead(EMPTY_EXTRA_STATE, first, NOW.getTime());
    const next = planExtras(input({ now: new Date(2026, 10, 15, 12), state }));
    expect(next.extras[0].language).not.toBe(first);
  });

  it('gives more languages a turn when asked', () => {
    const plan = planExtras(input({ prefs: { turnsPerDay: 3 } }));
    expect(new Set(plan.extras.map((e) => e.language)).size).toBe(3);
  });

  it('leaves out a language set to Off, and one with no cards', () => {
    const plan = planExtras(input({ prefs: { turnsPerDay: 3, modes: { th: 'off' } }, languages: ['th', 'es', 'el'] }));
    expect(plan.extras.map((e) => e.language)).toEqual(['es', 'el']);
  });

  it('offers no text while Read & Listen is off, or when texts are turned off', () => {
    for (const over of [{ readerOn: false }, { prefs: { read: false } }]) {
      const plan = planExtras(input({ ...over, prefs: { ...over.prefs, modes: { th: 'always' } } }));
      expect(plan.extras.some((e) => e.kind === 'read')).toBe(false);
      expect(plan.extras.filter((e) => e.language === 'th')).toHaveLength(2);
    }
  });

  it('never offers a drill that a deck has as skill cards', () => {
    for (let day = 0; day < 20; day++) {
      const plan = planExtras(input({ prefs: { modes: { th: 'always', ja: 'always' } }, languages: ['th', 'ja'], now: new Date(2026, 10, 1 + day, 12) }));
      for (const e of plan.extras) expect(['time', 'dates', 'money', 'numbers']).not.toContain(e.kind);
    }
  });

  it('passes a turn on from a language with nothing to offer', () => {
    // Texts off: Spanish has no drill, so it would never be practiced and would take every turn.
    let state = EMPTY_EXTRA_STATE;
    for (let day = 0; day < 4; day++) {
      const now = new Date(2026, 10, 14 + day, 12);
      const plan = planExtras(input({ prefs: { read: false }, languages: ['th', 'es'], state, now }));
      expect(plan.extras.map((e) => e.language)).toEqual(['th']);
      state = { ...state, plan: undefined };
    }
    expect(turnOrder(input({ prefs: { read: false }, languages: ['th', 'es'] }))).toEqual(['th']);
    expect(turnOrder(input({ languages: ['th', 'es'] }))).toEqual(['th', 'es']);
  });

  it('offers nothing when turned off or with no drills and no texts', () => {
    expect(planExtras(input({ prefs: { on: false } })).extras).toEqual([]);
    expect(planExtras(input({ prefs: { drills: false, read: false } })).extras).toEqual([]);
  });

  it('takes being turned off or on the same study day', () => {
    const plan = planExtras(input());
    expect(plan.extras.length).toBeGreaterThan(0);
    const off = planExtras(input({ prefs: { on: false }, state: { ...EMPTY_EXTRA_STATE, plan } }));
    expect(off.extras).toEqual([]);
    expect(planExtras(input({ state: { ...EMPTY_EXTRA_STATE, plan: off } })).extras).toEqual(plan.extras);
  });

  it('keeps the day\'s plan once made, whatever is done after', () => {
    const plan = planExtras(input());
    const state = recordRead({ ...EMPTY_EXTRA_STATE, plan }, plan.extras[0].language, NOW.getTime());
    expect(planExtras(input({ state }))).toBe(plan);
  });

  it('makes a new plan the next study day, and when a setting changes', () => {
    const plan = planExtras(input());
    const state = { ...EMPTY_EXTRA_STATE, plan };
    // 3 AM the next calendar day is still the same study day.
    expect(planExtras(input({ state, now: new Date(2026, 10, 15, 3) }))).toBe(plan);
    expect(planExtras(input({ state, now: new Date(2026, 10, 15, 5) }))).not.toBe(plan);
    expect(planExtras(input({ state, prefs: { modes: { th: 'always' } } }))).not.toBe(plan);
  });
});

describe('done', () => {
  const extra = { language: 'th', kind: 'counting', why: 'focus' } as const;

  it('needs the answers of today', () => {
    let state = EMPTY_EXTRA_STATE;
    for (let i = 0; i < EXTRA_ANSWERS - 1; i++) state = recordAnswer(state, 'counting', 'th', START + i * 1000);
    expect(isDone(state, extra, START)).toBe(false);
    expect(isDone(recordAnswer(state, 'counting', 'th', START + 99_000), extra, START)).toBe(true);
  });

  it('does not count yesterday\'s answers', () => {
    let state = EMPTY_EXTRA_STATE;
    for (let i = 0; i < EXTRA_ANSWERS; i++) state = recordAnswer(state, 'counting', 'th', START - 1000 - i);
    expect(isDone(state, extra, START)).toBe(false);
  });

  it('counts a text finished today', () => {
    const read = { language: 'th', kind: 'read', why: 'focus' } as const;
    expect(isDone(recordRead(EMPTY_EXTRA_STATE, 'th', START + 5), read, START)).toBe(true);
    expect(isDone(recordRead(EMPTY_EXTRA_STATE, 'es', START + 5), read, START)).toBe(false);
  });

  it('remembers the latest practice in a language', () => {
    const state = recordRead(recordAnswer(EMPTY_EXTRA_STATE, 'time', 'th', 50), 'th', 20);
    expect(lastPracticed(state, 'th')).toBe(50);
    expect(lastPracticed(state, 'es')).toBe(0);
  });

  it('keeps only the latest answers of a drill', () => {
    let state = EMPTY_EXTRA_STATE;
    for (let i = 0; i < 50; i++) state = recordAnswer(state, 'time', 'th', i);
    expect(state.answers['time|th']).toHaveLength(2 * EXTRA_ANSWERS);
    expect(state.answers['time|th'].at(-1)).toBe(49);
  });
});

describe('parsing', () => {
  it('falls back to the defaults for anything unreadable', () => {
    expect(parseExtraPrefs(null)).toEqual(DEFAULT_EXTRA_PREFS);
    expect(parseExtraPrefs('nope')).toEqual(DEFAULT_EXTRA_PREFS);
    expect(parseExtraPrefs(JSON.stringify({ turnsPerDay: 9, modes: { th: 'sometimes', xx: 'always', es: 'off' }, on: 'yes' }))).toEqual({ ...DEFAULT_EXTRA_PREFS, modes: { es: 'off' } });
  });

  it('round-trips the prefs', () => {
    const prefs: ExtraPrefs = { on: false, turnsPerDay: 3, modes: { th: 'always', ja: 'off' }, drills: false, read: true };
    expect(parseExtraPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it('round-trips the state and drops what it can\'t read', () => {
    const plan = planExtras(input({ prefs: { modes: { th: 'always' } } }));
    const state = recordRead(recordAnswer({ ...EMPTY_EXTRA_STATE, plan }, 'time', 'th', 7), 'es', 9);
    expect(parseExtraState(JSON.stringify(state))).toEqual(state);
    expect(parseExtraState('nope')).toEqual(EMPTY_EXTRA_STATE);
    expect(parseExtraState(JSON.stringify({ answers: { 'time|th': [1, 'x', 3] }, reads: { th: 'x', es: 4 }, plan: { start: 1, sig: 's', extras: [{ language: 'zz', kind: 'read', why: 'turn' }, { language: 'th', kind: 'read', why: 'turn' }] } })))
      .toEqual({ answers: { 'time|th': [1, 3] }, reads: { es: 4 }, plan: { start: 1, sig: 's', extras: [{ language: 'th', kind: 'read', why: 'turn' }] } });
  });
});

describe('extraDrillNames', () => {
  it('names every drill an extra may be, as the Practice tab does', () => {
    expect(extraDrillNames()).toBe('Counting things, reading the script, hearing sounds, writing by hand and which case');
  });
});
