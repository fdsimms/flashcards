import { describe, expect, it } from 'vitest';
import {
  COUNT_STEPS, DATE_STEPS, DRILL_STEPS, drawQuestion, nextDrillQuestion, MONEY_STEPS, questionText, drillAnswer, drillOfTags, drillStep, hasDrills, NUMBER_STEPS, questionKey, releasable, SKILL_TAG,
  heardRight, holdable, questionNote, languageOfDeck, missingByCard, skillDrafts, skillLanguageDeck, skillOffer, skillWordDrafts, stepWaits, studiedHeadwords, studiedIn, skillGroups, skillSections, suggestedRating, TIME_STEPS, type SkillCardInfo,
} from '../../src/tools/skills';
import { stepNeeds } from '../../src/tools/skillWords';
import { countEnding } from '../../src/tools/counting';
import { COUNTING } from '../../src/tools/tools';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('skill drills', () => {
  it('gives every step a unique id, and each later step the one before it', () => {
    expect(new Set(DRILL_STEPS.map((s) => s.id)).size).toBe(DRILL_STEPS.length);
    for (const ladder of [TIME_STEPS, NUMBER_STEPS, DATE_STEPS, MONEY_STEPS, COUNT_STEPS]) {
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

  it('asks missed questions again before drawing new ones', () => {
    const step = DATE_STEPS[0];
    const a = drawQuestion(step);
    const b = drawQuestion(step, a);
    const first = nextDrillQuestion(step, undefined, [a, b]);
    expect(first.question).toBe(a);
    const second = nextDrillQuestion(step, first.question, first.retry);
    expect(second.question).toBe(b);
    expect(second.retry).toEqual([]);
    expect(questionKey(nextDrillQuestion(step, b, second.retry).question)).not.toBe(questionKey(b));
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
    expect(skillGroups('pl').map((g) => g.id)).toEqual(['time', 'numbers', 'dates', 'money', 'counting', 'cases']);
    expect(skillGroups('en')).toEqual([]);
    expect(skillGroups('th').find((g) => g.id === 'consonants')?.count).toBe(44);
  });

  it('writes one drill card per step, each suspended until its step before settles or its words are studied', () => {
    const drafts = skillDrafts('th', 'Thai', ['time']);
    expect(drafts).toHaveLength(4);
    // The first step waits for "half" (ครึ่ง), the others for the step before.
    expect(drafts.map((d) => d.suspended)).toEqual([true, true, true, true]);
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
      { title: 'Quarter past and to', detail: "Starts once you know o'clock and half past well", locked: true },
    ]);
    expect(sections[1].rows.map((r) => r.detail)).toEqual(['Not started yet', 'Due tomorrow']);
  });

  it('counts a set of letters by how many have settled', () => {
    const sections = skillSections([info('skill::consonants', { settled: true }), info('skill::consonants'), info('skill::consonants', { started: false })]);
    expect(sections).toEqual([{ title: 'Letters', rows: [{ title: 'Consonant classes', detail: '1 of 3 learned · 1 not started', meter: 33, locked: false }] }]);
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

describe('skill steps that wait for words', () => {
  const note = (id: string, deck: string, Entry: string, tags: string[] = []) => ({ id, deck, model: 'Omnilanguage', fields: { Entry, Meaning: 'x' }, tags });

  it('hold every first step that says a word back, and the rest as before', () => {
    const suspended = (lang: 'th' | 'nb', groups: ('time' | 'numbers' | 'dates' | 'money')[]) => skillDrafts(lang, 'x', groups).map((d) => [d.tags.find((t) => t.startsWith('skill::drill::'))!.slice(14), d.suspended]);
    expect(suspended('nb', ['dates'])).toEqual([['dates-day', true], ['dates-weekday', true], ['dates-year', true]]);
    expect(suspended('nb', ['numbers', 'money'])).toEqual(expect.arrayContaining([['numbers-10', true], ['money-100', true]]));
    expect(stepWaits(drillStep('time-hours')!, 'nb')).toBe(true);
    // Thai has no word for a quarter, so its quarter step waits only for the hours before it.
    expect(stepWaits(drillStep('time-quarters')!, 'th')).toBe(true);
    expect(stepWaits(drillStep('time-five')!, 'nb')).toBe(true);
    expect(stepWaits(drillStep('time-hours')!, 'en')).toBe(false);
  });

  it('write the words for the groups that need them, and nothing for the others', () => {
    expect(skillWordDrafts('nb', ['dates'])).toHaveLength(19);
    expect(skillWordDrafts('nb', ['time', 'numbers', 'money']).map((d) => d.fields.Entry)).toEqual(expect.arrayContaining(['halv', 'kvart', 'en', 'ti', 'hundre', 'tusen', 'krone']));
    expect(skillWordDrafts('nb', ['consonants', 'classifiers'])).toEqual([]);
    expect(skillWordDrafts('en', ['dates'])).toEqual([]);
  });

  it('say what a card still waits for, from the headwords studied in its own language deck', () => {
    const notes = new Map([
      ['n1', note('n1', 'Norsk::Skills', '', ['skill', 'skill::drill::dates-day', 'skill::lang::nb'])],
      ['n2', note('n2', 'Norsk::Skills', '', ['skill', 'skill::drill::dates-year', 'skill::lang::nb'])],
    ]);
    const cards = [{ id: 'c1', noteId: 'n1' }, { id: 'c2', noteId: 'n2' }];
    const asks: string[] = [];
    const studied = (words: string[]) => (deck: string) => { asks.push(deck); return words; };
    expect(missingByCard(cards, notes, studied(['januar']))).toEqual(new Map([['c1', ['2 more month names']], ['c2', ['2 more month names', 'weekday names']]]));
    expect(asks[0]).toBe('Norsk');
    expect(missingByCard(cards, notes, studied(['januar', 'februar', 'mars']))).toEqual(new Map([['c2', ['weekday names']]]));
    expect(missingByCard(cards, notes, studied(['januar', 'februar', 'mars', 'søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag']))).toEqual(new Map());
  });

  it('never count a word studied in another language\'s deck', () => {
    const started = { sched: { state: 2 } };
    const all = [note('g1', 'Deutsch::Tier 1', 'Januar'), note('g2', 'Deutsch', 'Februar'), note('g3', 'Deutsch', 'März'), note('s1', 'Norsk::Tier 1', 'januar'), note('s2', 'Norsk::Skills', 'mars', ['skill'])];
    const cards = all.map((n) => ({ noteId: n.id, ...started }));
    const norwegian = studiedHeadwords(all as never, cards, skillLanguageDeck('Norsk::Skills'));
    expect(norwegian).toEqual(['januar']);
    const skillNote = note('k', 'Norsk::Skills', '', ['skill', 'skill::drill::dates-day', 'skill::lang::nb']);
    expect(missingByCard([{ id: 'c', noteId: 'k' }], new Map([['k', skillNote]]), studiedIn(all as never, cards))).toEqual(new Map([['c', ['2 more month names']]]));
    expect(skillLanguageDeck('A::B::Skills')).toBe('A::B');
    expect(skillLanguageDeck('A::B')).toBe('A::B');
  });

  it('release a first step once its words are studied, but never one already started or in a paused deck', () => {
    const first = { id: 'a', stepId: 'dates-day', language: 'nb' as const, suspended: true, settled: false, started: false };
    expect(releasable([{ ...first, missing: ['2 more month names'] }])).toEqual([]);
    expect(releasable([{ ...first, missing: [] }])).toEqual(['a']);
    expect(releasable([first])).toEqual(['a']);
    expect(releasable([{ ...first, started: true }])).toEqual([]);
    expect(releasable([{ ...first, suspended: false }])).toEqual([]);
    expect(releasable([{ ...first, paused: true }])).toEqual([]);
    // A step with nothing to wait for, such as the five-minute one with nothing before it, isn't released this way.
    expect(releasable([{ ...first, stepId: 'time-five' }])).toEqual([]);
  });

  it('release a later step only while its deck is not paused', () => {
    const before = { id: 'a', stepId: 'numbers-10', language: 'nb' as const, suspended: false, settled: true, started: true };
    const next = { id: 'b', stepId: 'numbers-99', language: 'nb' as const, suspended: true, settled: false, started: false };
    expect(releasable([before, next])).toEqual(['b']);
    expect(releasable([{ ...before, paused: true }, { ...next, paused: true }])).toEqual([]);
  });

  it('hold back a live card that was never started and lacks its words, and nothing else', () => {
    const live = { id: 'a', stepId: 'dates-day', language: 'nb' as const, suspended: false, settled: false, started: false, missing: ['3 month names'] };
    expect(holdable([live])).toEqual(['a']);
    expect(holdable([{ ...live, started: true }])).toEqual([]);
    expect(holdable([{ ...live, suspended: true }])).toEqual([]);
    expect(holdable([{ ...live, paused: true }])).toEqual([]);
    expect(holdable([{ ...live, missing: [] }])).toEqual([]);
    expect(holdable([{ ...live, stepId: 'time-five' }])).toEqual([]);
  });

  it('need the words their steps say', () => {
    expect(stepNeeds('dates-day', 'nb').map((n) => n.label)).toEqual(['month names']);
    expect(stepNeeds('dates-year', 'nb').map((n) => n.label)).toEqual(['month names', 'weekday names']);
    expect(stepNeeds('time-five', 'nb')).toEqual([]);
  });

  it('ask only about the months known', () => {
    const step = drillStep('dates-day')!;
    let state = 3;
    const random = () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
    let previous: ReturnType<typeof drawQuestion> | undefined;
    for (let i = 0; i < 100; i++) {
      const q = drawQuestion(step, previous, random, 'nb', [2, 11]);
      expect(q.kind === 'date' && [2, 11].includes(q.date.month)).toBe(true);
      previous = q;
    }
    const next = nextDrillQuestion(step, undefined, [], random, 'nb', [7]);
    expect(next.question.kind === 'date' && next.question.date.month).toBe(7);
  });
});

describe('counting things drills', () => {
  const draw = (step: (typeof COUNT_STEPS)[number], language: 'pl' | 'ru') => {
    const q = drawQuestion(step, undefined, Math.random, language);
    if (q.kind !== 'count') throw new Error('not a count');
    return q.question;
  };

  it('is offered in Polish and Russian only, as four steps each waiting on the one before', () => {
    expect(COUNT_STEPS.map((s) => s.title)).toEqual(['1 with the noun', '2 to 4', '5 and up', 'Any number to 100']);
    expect(hasDrills('counting', 'pl')).toBe(true);
    expect(hasDrills('counting', 'ru')).toBe(true);
    // German has counting nouns but no case to learn from the number.
    expect(hasDrills('counting', 'de')).toBe(false);
    expect(hasDrills('counting', 'th')).toBe(false);
    expect(skillGroups('ru').find((g) => g.id === 'counting')).toMatchObject({ title: 'Counting things', count: 4 });
    expect(skillGroups('de').some((g) => g.id === 'counting')).toBe(false);
  });

  it('draws a number within each step, and a noun of the language', () => {
    for (const language of ['pl', 'ru'] as const) {
      for (let k = 0; k < 300; k++) {
        expect(draw(COUNT_STEPS[0], language).n).toBe(1);
        const few = draw(COUNT_STEPS[1], language);
        expect(countEnding(few.n)).toBe('2-4');
        const many = draw(COUNT_STEPS[2], language);
        expect(many.n).toBeGreaterThanOrEqual(5);
        expect(['many', 'teen']).toContain(countEnding(many.n));
        const any = draw(COUNT_STEPS[3], language);
        expect(any.n).toBeGreaterThanOrEqual(1);
        expect(any.n).toBeLessThanOrEqual(100);
        for (const q of [few, many, any]) expect(q.noun).toBeLessThan(COUNTING[language]!.nouns.length);
      }
    }
  });

  it('reaches 22 and 21 only in the last step', () => {
    const seen = (step: (typeof COUNT_STEPS)[number]) => new Set(Array.from({ length: 2000 }, () => draw(step, 'pl').n));
    expect(seen(COUNT_STEPS[1]).has(22)).toBe(true);
    expect(seen(COUNT_STEPS[2]).has(21)).toBe(false);
    expect(seen(COUNT_STEPS[2]).has(22)).toBe(false);
    expect(seen(COUNT_STEPS[3]).has(21)).toBe(true);
  });

  it('shows the count with its noun, says it as the tool does, and gives the rule', () => {
    const q = { kind: 'count' as const, question: { noun: 0, n: 5 } };
    expect(questionText(q, 'pl')).toBe('5 kot');
    expect(questionText(q, 'ru')).toBe('5 кот');
    expect(questionNote(q, 'pl')).toBe('cat');
    expect(questionNote(q, 'ru')).toBe('kot · cat');
    expect(questionNote({ kind: 'money', amount: 100 }, 'pl')).toBeUndefined();
    expect(drillAnswer(q, 'pl')?.everyday.text).toBe('pięć kotów');
    expect(drillAnswer(q, 'ru')?.everyday.text).toBe('пять котов');
    expect(drillAnswer(q, 'pl')?.last?.title).toBe('Rule');
    expect(drillAnswer({ kind: 'count', question: { noun: 5, n: 2 } }, 'pl')?.everyday.text).toBe('dwie książki');
    expect(drillAnswer(q, 'en')).toBeUndefined();
  });

  it('takes a spoken count said in words or with the number as digits', () => {
    const q = { kind: 'count' as const, question: { noun: 0, n: 5 } };
    expect(heardRight(q, 'pięć kotów', 'pl')).toBe(true);
    expect(heardRight(q, '5 kotów', 'pl')).toBe(true);
    expect(heardRight(q, '5 koty', 'pl')).toBe(false);
    expect(heardRight(q, 'pięć koty', 'pl')).toBe(false);
  });

  it('writes one card per step, the first live and the rest suspended, and none for other languages', () => {
    const drafts = skillDrafts('pl', 'Polish', ['counting']);
    expect(drafts.map((d) => d.suspended)).toEqual([false, true, true, true]);
    expect(drafts[0].tags).toEqual([SKILL_TAG, 'skill::drill::counting-one', 'skill::lang::pl']);
    expect(drafts[0].fields.Front).toContain('Polish · Counting things: 1 with the noun');
    expect(skillDrafts('de', 'German', ['counting'])).toEqual([]);
    expect(skillWordDrafts('pl', ['counting'])).toEqual([]);
  });

  it('lists the steps in Skills under Counting things', () => {
    const sections = skillSections([{ tags: ['skill', 'skill::drill::counting-one', 'skill::lang::pl'], suspended: false, started: false, settled: false, dueInDays: 0 }]);
    expect(sections).toEqual([{ title: 'Counting things', rows: [{ title: '1 with the noun', detail: 'Not started yet', locked: false }] }]);
  });
});
