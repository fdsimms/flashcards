import { describe, expect, it } from 'vitest';
import {
  DATE_STEPS, DRILL_STEPS, drawQuestion, MONEY_STEPS, questionText, drillAnswer, drillOfTags, drillStep, hasDrills, NUMBER_STEPS, questionKey, releasable, SKILL_TAG,
  heardRight, languageOfDeck, missingWords, skillDrafts, skillOffer, stepWords, skillGroups, skillSections, suggestedRating, TIME_STEPS, type SkillCardInfo,
} from '../../src/tools/skills';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('skill drills', () => {
  it('gives every step a unique id, and each later step the one before it', () => {
    expect(new Set(DRILL_STEPS.map((s) => s.id)).size).toBe(DRILL_STEPS.length);
    for (const ladder of [TIME_STEPS, NUMBER_STEPS, DATE_STEPS, MONEY_STEPS]) {
      expect(ladder[0].after).toBeUndefined();
      ladder.slice(1).forEach((s, i) => expect(s.after).toBe(ladder[i].id));
    }
    expect(drillStep('time-quarters')?.title).toBe('Quarter past and to');
    expect(drillStep('nope')).toBeUndefined();
  });

  it('draws times within each step', () => {
    for (let k = 0; k < 200; k++) {
      const hours = drawQuestion(TIME_STEPS[0]);
      const quarters = drawQuestion(TIME_STEPS[1]);
      const five = drawQuestion(TIME_STEPS[2]);
      if (hours.kind !== 'time' || quarters.kind !== 'time' || five.kind !== 'time') throw new Error('not a time');
      expect([0, 30]).toContain(hours.time.minute);
      expect([15, 45]).toContain(quarters.time.minute);
      expect(five.time.minute % 5).toBe(0);
      for (const t of [hours.time, quarters.time, five.time]) expect(t.hour).toBeGreaterThanOrEqual(0);
    }
  });

  it('draws numbers within each step', () => {
    for (const step of NUMBER_STEPS) {
      for (let k = 0; k < 200; k++) {
        const q = drawQuestion(step);
        if (q.kind !== 'number' || q.question.kind !== 'number') throw new Error('not a number');
        const { min, max } = step as unknown as { min: number; max: number };
        expect(q.question.n).toBeGreaterThanOrEqual(min);
        expect(q.question.n).toBeLessThanOrEqual(max);
      }
    }
  });

  it('never asks the same question twice in a row', () => {
    for (const step of DRILL_STEPS) {
      let previous = drawQuestion(step, undefined, seq([0.3]));
      for (let k = 0; k < 50; k++) {
        const next = drawQuestion(step, previous);
        expect(questionKey(next)).not.toBe(questionKey(previous));
        previous = next;
      }
    }
  });

  it('answers in the language, with the formal form for a time', () => {
    const time = drillAnswer({ kind: 'time', time: { hour: 14, minute: 30 } }, 'th');
    expect(time?.everyday.text).toBeTruthy();
    expect(time?.last?.title).toBe('Formal');
    const number = drillAnswer({ kind: 'number', question: { kind: 'number', n: 7 } }, 'pl');
    expect(number?.everyday.text).toBeTruthy();
    expect(drillAnswer({ kind: 'number', question: { kind: 'number', n: 7 } }, 'en')).toBeUndefined();
  });

  it('knows which languages have the drills', () => {
    expect(hasDrills('time', 'th')).toBe(true);
    expect(hasDrills('numbers', 'pl')).toBe(true);
    expect(hasDrills('time', 'en')).toBe(false);
  });

  it('suggests Good for all right, Hard for one miss, Again for more', () => {
    expect(suggestedRating([true, true, true])).toBe(3);
    expect(suggestedRating([true, false, true])).toBe(2);
    expect(suggestedRating([false, false, true])).toBe(1);
    expect(suggestedRating([])).toBe(3);
  });
});


describe('skill cards in the collection', () => {
  it('offers the groups a language has', () => {
    expect(skillGroups('th').map((g) => g.id)).toEqual(['time', 'numbers', 'dates', 'money', 'consonants', 'vowels', 'classifiers']);
    expect(skillGroups('pl').map((g) => g.id)).toEqual(['time', 'numbers', 'dates', 'money', 'cases']);
    expect(skillGroups('en')).toEqual([]);
    expect(skillGroups('th').find((g) => g.id === 'consonants')?.count).toBe(44);
  });

  it('writes one drill card per step, the later steps suspended', () => {
    const drafts = skillDrafts('th', 'Thai', ['time']);
    expect(drafts).toHaveLength(4);
    expect(drafts.map((d) => d.suspended)).toEqual([false, true, true, true]);
    expect(drafts[0].tags).toEqual([SKILL_TAG, 'skill::drill::time-hours', 'skill::lang::th']);
    expect(drafts[0].fields.Front).toContain("Thai · Telling the time: O'clock and half past");
  });

  it('writes a card per consonant, none suspended, and none for a language without them', () => {
    const drafts = skillDrafts('th', 'Thai', ['consonants']);
    expect(drafts).toHaveLength(44);
    expect(drafts.every((d) => !d.suspended && d.tags.includes('skill::consonants'))).toBe(true);
    expect(new Set(drafts.map((d) => d.fields.Front)).size).toBe(44);
    expect(skillDrafts('pl', 'Polish', ['consonants'])).toEqual([]);
  });

  it('gives each language its own first field, so the same step in two languages is two notes', () => {
    expect(skillDrafts('th', 'Thai', ['numbers'])[0].fields.Front).not.toBe(skillDrafts('pl', 'Polish', ['numbers'])[0].fields.Front);
  });

  it('reads a drill back from its tags', () => {
    expect(drillOfTags(['skill', 'skill::drill::numbers-99', 'skill::lang::pl'])).toMatchObject({ step: { id: 'numbers-99' }, language: 'pl' });
    expect(drillOfTags(['skill::drill::numbers-99', 'skill::lang::pl'])).toBeUndefined();
    expect(drillOfTags(['skill', 'skill::consonants', 'skill::lang::th'])).toBeUndefined();
    expect(drillOfTags(['skill', 'skill::drill::nope', 'skill::lang::th'])).toBeUndefined();
    expect(drillOfTags(['skill', 'skill::drill::time-any', 'skill::lang::xx'])).toBeUndefined();
  });

  it('releases a step once the step before has settled, in the same language only', () => {
    const cards = [
      { id: 'a', stepId: 'time-hours', language: 'th' as const, suspended: false, settled: true },
      { id: 'b', stepId: 'time-quarters', language: 'th' as const, suspended: true, settled: false },
      { id: 'c', stepId: 'time-five', language: 'th' as const, suspended: true, settled: false },
      { id: 'd', stepId: 'time-quarters', language: 'pl' as const, suspended: true, settled: false },
      { id: 'e', stepId: 'time-hours', language: 'pl' as const, suspended: false, settled: false },
    ];
    expect(releasable(cards)).toEqual(['b']);
  });
});

describe("a deck's language", () => {
  it('is read from its name, as Review reads it', () => {
    expect(languageOfDeck('Languages::Thai')).toEqual({ language: 'th', name: 'Thai' });
    expect(languageOfDeck('Polski::Verbs')).toEqual({ language: 'pl', name: 'Polish' });
    expect(languageOfDeck('🧠 Trivia')).toBeUndefined();
  });
});


describe('skill progress', () => {
  const info = (tag: string, over: Partial<SkillCardInfo> = {}) => ({
    tags: ['skill', tag, 'skill::lang::th'], suspended: false, started: true, settled: false, dueInDays: 3, percent: 90, ...over,
  });

  it('lists each drill step in order, locked, new or with when it is due', () => {
    const sections = skillSections([
      info('skill::drill::time-quarters', { suspended: true }),
      info('skill::drill::time-hours', { dueInDays: 12, percent: 94 }),
      info('skill::drill::numbers-10', { started: false }),
      info('skill::drill::numbers-99', { dueInDays: 1 }),
    ]);
    expect(sections.map((s) => s.title)).toEqual(['Telling the time', 'Numbers']);
    expect(sections[0].rows).toEqual([
      { title: "O'clock and half past", detail: 'Next in 12 days', meter: 94, locked: false },
      { title: 'Quarter past and to', detail: "Comes in after o'clock and half past settles", locked: true },
    ]);
    expect(sections[1].rows.map((r) => r.detail)).toEqual(['Not started yet', 'Due tomorrow']);
  });

  it('counts a set of letters by how many have settled', () => {
    const sections = skillSections([info('skill::consonants', { settled: true }), info('skill::consonants'), info('skill::consonants', { started: false })]);
    expect(sections).toEqual([{ title: 'Letters', rows: [{ title: 'Consonant classes', detail: '1 of 3 settled · 1 not started', meter: 33, locked: false }] }]);
  });

  it('is empty with no skill cards', () => {
    expect(skillSections([])).toEqual([]);
  });
});

describe('dates and money drills', () => {
  it('asks a date with the parts of its step, and says it in the language', () => {
    for (const step of DATE_STEPS) {
      const q = drawQuestion(step);
      if (q.kind !== 'date') throw new Error('not a date');
      expect(q.parts).toEqual((step as unknown as { parts: unknown }).parts);
      expect(drillAnswer(q, 'th')?.last?.title).toBe('As written');
    }
    expect(questionText({ kind: 'date', date: { year: 2026, month: 11, day: 12 }, parts: { weekday: true, year: true } })).toBe('Thursday, November 12, 2026');
    expect(questionText({ kind: 'date', date: { year: 2026, month: 11, day: 12 }, parts: { weekday: false, year: false } })).toBe('November 12');
  });

  it("asks a price within the step, in the language's own money", () => {
    for (let k = 0; k < 100; k++) {
      const q = drawQuestion(MONEY_STEPS[0], undefined, Math.random, 'th');
      if (q.kind !== 'money') throw new Error('not money');
      expect(q.amount).toBeGreaterThan(0);
      expect(q.amount).toBeLessThanOrEqual(100 * 100);
    }
    expect(questionText({ kind: 'money', amount: 135000 }, 'th')).toBe('฿1,350');
    expect(drillAnswer({ kind: 'money', amount: 135000 }, 'th')?.everyday.text).toBeTruthy();
  });

  it('writes a card per Thai vowel and per case-taking word, with unique first fields', () => {
    const vowels = skillDrafts('th', 'Thai', ['vowels']);
    expect(vowels.length).toBeGreaterThan(10);
    expect(new Set(vowels.map((d) => d.fields.Front)).size).toBe(vowels.length);
    expect(vowels[0].fields.Back).toMatch(/Short|Long/);
    const cases = skillDrafts('pl', 'Polish', ['cases']);
    expect(cases.length).toBeGreaterThan(10);
    expect(new Set(cases.map((d) => d.fields.Front)).size).toBe(cases.length);
    expect(cases[0].fields.Back).toContain('takes the');
    expect(skillDrafts('th', 'Thai', ['cases'])).toEqual([]);
  });

  it('counts vowels with the letters and cases under grammar', () => {
    const tag = (t: string, settled: boolean) => ({ tags: ['skill', `skill::${t}`], suspended: false, started: true, settled, dueInDays: 2, percent: 80 });
    const sections = skillSections([tag('consonants', true), tag('vowels', false), tag('cases', true)]);
    expect(sections.map((s) => [s.title, s.rows.map((r) => r.title)])).toEqual([['Letters', ['Consonant classes', 'Vowel length']], ['Grammar', ['Which case']]]);
  });
});

describe('the five additions', () => {
  it('writes a classifier card per Thai noun, and none for a language without classifiers', () => {
    const drafts = skillDrafts;
    const groups = skillGroups;
    const th = drafts('th', 'Thai', ['classifiers']);
    expect(th.length).toBeGreaterThan(10);
    expect(th[0].fields.Front).toContain('Which classifier?');
    expect(th[0].tags).toContain('skill::classifiers');
    expect(groups('th').some((g) => g.id === 'classifiers')).toBe(true);
    expect(groups('ja').find((g) => g.id === 'classifiers')?.title).toBe('Counters');
    expect(drafts('pl', 'Polish', ['classifiers'])).toEqual([]);
  });

  it('waits for the words a step needs, and says so', () => {
    const release = releasable;
    const sections = skillSections;
    expect(stepWords('numbers-999', 'th')).toEqual(['ร้อย']);
    expect(stepWords('money-10000', 'pl')).toEqual(['tysiąc']);
    expect(stepWords('time-quarters', 'pl')).toEqual(['kwadrans']);
    expect(stepWords('numbers-99', 'th')).toEqual([]);
    expect(missingWords(['ร้อย'], ['หนึ่งร้อย', 'แมว'])).toEqual(['ร้อย']);
    expect(missingWords(['ร้อย'], ['ร้อย'])).toEqual([]);
    expect(missingWords(['sto'], ['Sto, setka'])).toEqual([]);
    expect(missingWords(['sto'], ['stopa'])).toEqual(['sto']);
    const cards = [
      { id: 'a', stepId: 'numbers-99', language: 'th' as const, suspended: false, settled: true },
      { id: 'b', stepId: 'numbers-999', language: 'th' as const, suspended: true, settled: false, missing: ['ร้อย'] },
    ];
    expect(release(cards)).toEqual([]);
    expect(release([cards[0], { ...cards[1], missing: [] }])).toEqual(['b']);
    const shown = sections([{ tags: ['skill', 'skill::drill::numbers-999'], suspended: true, started: false, settled: false, dueInDays: 0, missing: ['ร้อย'] }]);
    expect(shown[0].rows[0].detail).toBe('Waiting for ร้อย in your deck');
  });

  it('suggests Hard for a drill all right but slow', () => {
    expect(suggestedRating([true, true, true], [2000, 3000, 2500], 'time')).toBe(3);
    expect(suggestedRating([true, true, true], [9000, 7000, 1000], 'time')).toBe(2);
    expect(suggestedRating([true, false, true], [1000, 1000, 1000], 'time')).toBe(2);
    expect(suggestedRating([true, true, true], [9000, 9000, 9000])).toBe(3);
  });

  it('takes a spoken answer said any accepted way, or as the digits the phone wrote', () => {
    const q = { kind: 'number' as const, question: { kind: 'number' as const, n: 1350 } };
    const said = drillAnswer(q, 'th')!.everyday.text;
    expect(heardRight(q, said, 'th')).toBe(true);
    expect(heardRight(q, said.replace(/\s/g, '') + '.', 'th')).toBe(true);
    expect(heardRight(q, '1350', 'th')).toBe(true);
    expect(heardRight(q, '1,350', 'th')).toBe(true);
    expect(heardRight(q, '1351', 'th')).toBe(false);
    expect(heardRight(q, '', 'th')).toBe(false);
    const t = { kind: 'time' as const, time: { hour: 14, minute: 45 } };
    expect(heardRight(t, '14:45', 'pl')).toBe(true);
    expect(heardRight(t, '2:45', 'pl')).toBe(true);
    expect(heardRight({ kind: 'money', amount: 135000 }, '1350', 'th')).toBe(true);
  });

  it('offers skill cards for a language deck without any', () => {
    expect(skillOffer('Thai', [])).toBe('Thai');
    expect(skillOffer('Thai', [{ deck: 'Thai::Skills', tags: ['skill'] }])).toBeUndefined();
    expect(skillOffer('🧠 Trivia', [])).toBeUndefined();
  });
});
