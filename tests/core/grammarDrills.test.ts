import { describe, expect, it } from 'vitest';
import { grammarPoint } from '../../src/core/grammar';
import { drillPrompts, drillWentWell, dueByLanguage, dueWhen, duePoints, drillResults, grammarListGroups, hasDrill, isDrilled, missingNote, namesAnswer, pointSchedule, practiceKinds, scheduledPoints, type GrammarAnswer } from '../../src/core/grammarDrills';

const H = 4;
const NOW = new Date(2026, 10, 12, 12);
const day = (d: number) => new Date(2026, 10, d, H);
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
/** A drill on a point: `right` of `total` answered right, on day `d`. */
function drill(pointId: string, id: string, d: number, right: number, total = 5): GrammarAnswer[] {
  return Array.from({ length: total }, (_, i) => ({ pointId, drillId: id, kind: 'gap', correct: i < right, answeredAt: at(d, 12) }));
}

describe('when a point is next drilled', () => {
  it('is today for a point never drilled', () => {
    expect(pointSchedule('es.preterite', 'practice', [], NOW, H)).toMatchObject({ due: day(12), step: -1 });
  });

  it('moves out 1, 3, 7, 14, then 30 days with each drill that goes well', () => {
    const answers = [...drill('es.preterite', 'a', 1, 5), ...drill('es.preterite', 'b', 2, 4), ...drill('es.preterite', 'c', 5, 5)];
    expect(pointSchedule('es.preterite', 'practice', answers.slice(0, 5), NOW, H)).toMatchObject({ due: day(2), step: 0 });
    expect(pointSchedule('es.preterite', 'practice', answers.slice(0, 10), NOW, H)).toMatchObject({ due: day(5), step: 1 });
    expect(pointSchedule('es.preterite', 'practice', answers, NOW, H)).toMatchObject({ due: day(12), step: 2 });
    const many = Array.from({ length: 8 }, (_, i) => drill('es.preterite', `d${i}`, 1, 5)).flat().map((a, i) => ({ ...a, answeredAt: at(1, 5 + Math.floor(i / 5)) }));
    expect(pointSchedule('es.preterite', 'practice', many, NOW, H).step).toBe(4); // capped at 30 days
  });

  it('comes back the next day after a drill that went badly, from the first step', () => {
    const answers = [...drill('es.preterite', 'a', 1, 5), ...drill('es.preterite', 'b', 3, 5), ...drill('es.preterite', 'c', 8, 3)];
    expect(pointSchedule('es.preterite', 'practice', answers, NOW, H)).toMatchObject({ due: day(9), step: -1 });
  });

  it('forgives one slip on a point with 3 or 4 questions in a drill, as a 4/3/3 split gives', () => {
    expect([drillWentWell(8, 10), drillWentWell(4, 5), drillWentWell(3, 4), drillWentWell(2, 3)]).toEqual([true, true, true, true]);
    expect([drillWentWell(7, 10), drillWentWell(3, 5), drillWentWell(2, 4), drillWentWell(1, 3)]).toEqual([false, false, false, false]);
    // One or two questions: all but one would be half or none of them.
    expect([drillWentWell(1, 1), drillWentWell(2, 2), drillWentWell(0, 1), drillWentWell(1, 2)]).toEqual([true, true, false, false]);
    expect(pointSchedule('es.preterite', 'practice', drill('es.preterite', 'a', 10, 3, 4), NOW, H)).toMatchObject({ due: day(11), step: 0 });
    expect(pointSchedule('es.preterite', 'normal', drill('es.preterite', 'a', 10, 2, 3), NOW, H)).toMatchObject({ due: day(17), step: 0 });
    expect(pointSchedule('es.preterite', 'practice', drill('es.preterite', 'a', 10, 2, 4), NOW, H)).toMatchObject({ due: day(11), step: -1 });
  });

  it('spaces a known point further, and still brings it back the next day after a drill that went badly', () => {
    expect(pointSchedule('es.preterite', 'normal', drill('es.preterite', 'a', 1, 5), NOW, H).due).toEqual(day(8));
    expect(pointSchedule('es.preterite', 'normal', drill('es.preterite', 'a', 10, 1), NOW, H)).toMatchObject({ due: day(11), step: -1 });
  });

  it('counts a drill on its study day, and only its own point', () => {
    const late = drill('es.preterite', 'a', 11, 5).map((a) => ({ ...a, answeredAt: at(12, 2) })); // 2 AM: still the 11th
    const mixed = [...late, ...drill('es.imperfect', 'a', 12, 0)];
    expect(pointSchedule('es.preterite', 'practice', mixed, NOW, H).due).toEqual(day(12));
  });
});

describe('which points are drilled', () => {
  const choices = { 'es.preterite': 'normal', 'es.imperfect': 'practice', 'es.future': 'avoid', 'es.conditional': 'unset', 'th.ever': 'practice' } as const;

  it('drills Practice and Know it only', () => {
    expect(isDrilled('practice') && isDrilled('normal')).toBe(true);
    expect(isDrilled('avoid') || isDrilled('unset') || isDrilled(undefined)).toBe(false);
  });

  it("lists a language's due points, Practice first", () => {
    expect(duePoints('es', choices, [], NOW, H).map((s) => s.pointId)).toEqual(['es.imperfect', 'es.preterite']);
    const done = drill('es.imperfect', 'a', 12, 5);
    expect(duePoints('es', choices, done, NOW, H).map((s) => s.pointId)).toEqual(['es.preterite']);
    expect(scheduledPoints('es', choices, done, NOW, H).map((s) => s.pointId)).toEqual(['es.preterite', 'es.imperfect']);
    expect(duePoints('th', choices, [], NOW, H).map((s) => s.pointId)).toEqual(['th.ever']);
    expect(duePoints('es', { 'es.gone': 'practice' }, [], NOW, H)).toEqual([]);
  });

  it('says when, in study days', () => {
    expect(dueWhen(day(12), NOW, H)).toBe('Due today');
    expect(dueWhen(day(10), NOW, H)).toBe('Due today');
    expect(dueWhen(day(13), NOW, H)).toBe('Tomorrow');
    expect(dueWhen(day(19), NOW, H)).toBe('In 7 days');
  });

  it("counts a point's drill answers since a time", () => {
    const answers = [...drill('es.preterite', 'a', 1, 2, 3), ...drill('es.preterite', 'b', 10, 4)];
    expect(drillResults('es.preterite', answers, day(5))).toEqual({ answers: 5, right: 4 });
  });
});

describe("a drill's questions as the screen asks them", () => {
  const random = () => 0.5;

  it('asks which point a line read uses, from its name and its related ones', () => {
    const [p] = drillPrompts([{ kind: 'which', point: 'es.preterite', line: 'Ayer Fuimos al mercado.', words: ['fuimos'], english: 'Yesterday we went.', title: 'Al mercado', choices: ['es.preterite', 'es.imperfect', 'es.present_perfect'] }], random);
    expect(p).toMatchObject({ kind: 'which', before: 'Ayer ', middle: 'Fuimos', after: ' al mercado.', answer: 'Preterite', source: 'From Al mercado', typable: false });
    expect([...p.choices].sort()).toEqual(['Imperfect', 'Present perfect', 'Preterite']);
  });

  it('underlines the matched word itself, not the same letters inside another word', () => {
    const [p] = drillPrompts([{ kind: 'which', point: 'es.preterite', line: 'Fuera de casa, fue al mercado.', words: ['fue'], english: '', title: 'T', choices: ['es.preterite', 'es.imperfect'] }], random);
    expect(p).toMatchObject({ before: 'Fuera de casa, ', middle: 'fue', after: ' al mercado.' });
  });

  it('fills a gap, naming the point and the hint, but not a Thai point, which would give it away', () => {
    const [es, th] = drillPrompts([
      { kind: 'gap', id: 1, point: 'es.preterite', before: 'Ayer ', answer: 'fuimos', after: ' al mercado.', english: 'Yesterday we went.', wrong: ['íbamos', 'vamos', 'iremos'], hint: 'ir, nosotros' },
      { kind: 'gap', id: 2, point: 'th.ever', before: 'คุณ', answer: 'เคย', after: 'ไปเชียงใหม่ไหม', english: 'Have you ever been to Chiang Mai?', wrong: ['กำลัง', 'จะ', 'ต้อง'], hint: '' },
    ], random);
    expect(es).toMatchObject({ label: 'Preterite · ir, nosotros', answer: 'fuimos', typable: true });
    expect([...es.choices].sort()).toEqual(['fuimos', 'iremos', 'vamos', 'íbamos']);
    expect(th.label).toBe('');
  });

  it('leaves out a point name that contains the answer, in any language', () => {
    const [el] = drillPrompts([
      { kind: 'gap', id: 4, point: 'el.na', before: 'Προσπαθώ ', answer: 'να', after: ' γράψω ένα ποίημα.', english: 'I am trying to write a poem.', wrong: ['και', 'θα', 'πως'], hint: '' },
    ], random);
    expect(el.label).toBe('');
  });

  it('leaves out a point name holding a word of a longer answer, but not English that happens to be in it', () => {
    const gap = (point: string, answer: string, hint: string) =>
      drillPrompts([{ kind: 'gap', id: 5, point, before: '', answer, after: '', english: '', wrong: ['x'], hint }], random)[0].label;
    expect(gap('el.tha', 'θα πάμε', 'πάω, εμείς')).toBe('πάω, εμείς');
    expect(gap('ja.te_iru', '食べている', '食べる')).toBe('食べる');
    expect(gap('ru.future', 'буду читать', 'читать, я')).toBe('читать, я');
    expect(gap('pl.future', 'będę czytać', 'czytać, ja')).toBe('czytać, ja');
    expect(gap('nb.past', 'passet', 'passe')).toBe('Past tense · passe');
    expect(namesAnswer('Past tense', 'pastaen')).toBe(false);
  });

  it("leaves out a question it can't ask", () => {
    expect(drillPrompts([
      { kind: 'which', point: 'es.preterite', line: 'Hoy como.', words: ['fuimos'], english: '', title: '', choices: ['es.preterite', 'es.imperfect'] },
      { kind: 'gap', id: 3, point: 'es.gone', before: '', answer: 'x', after: '', english: '', wrong: [], hint: '' },
    ])).toEqual([]);
  });

  it('says why a point got no questions', () => {
    expect(missingNote([], true)).toBeUndefined();
    expect(missingNote(['es.preterite', 'es.imperfect'], true)).toBe("No questions for Preterite and Imperfect yet. They're being written now, so try again in a minute.");
    expect(missingNote(['es.preterite'], false)).toContain('add a Claude key');
  });
});

describe('what a point can be practiced with', () => {
  const kinds = (id: string) => practiceKinds(grammarPoint(id)!);

  it('gives a point named after its word practice against its rivals, not a question naming it', () => {
    expect(kinds('th.already')).toEqual(['contrast']);
    expect(kinds('el.na')).toEqual(['contrast']);
  });

  it('gives a word-named point with no word beside it nothing to practice', () => {
    expect(kinds('th.must')).toEqual([]);
    expect(hasDrill('th.must')).toBe(false);
    expect(hasDrill('th.already')).toBe(true);
  });

  it('gives the others questions, and Forms practice when they have forms', () => {
    expect(kinds('es.preterite')).toEqual(['questions', 'forms']);
    expect(kinds('de.perfect')).toEqual(['questions']);
  });

  it("doesn't schedule a point with nothing to practice", () => {
    const choices = { 'th.must': 'practice', 'th.already': 'practice' } as const;
    expect(duePoints('th', choices, [], NOW, H).map((s) => s.pointId)).toEqual(['th.already']);
    expect(scheduledPoints('th', choices, [], NOW, H).map((s) => s.pointId)).toEqual(['th.already']);
  });
});

describe("a drill on a point named after its word", () => {
  it('never asks which point a line uses, even from a server that sends one', () => {
    expect(drillPrompts([
      { kind: 'which', point: 'th.already', line: 'วันนี้ดึกแล้ว', words: ['แล้ว'], english: '', title: 'x', choices: ['th.already', 'th.ever'] },
    ])).toEqual([]);
  });

  it("counts a rival word's question for the point whose drill it is", () => {
    const [own, rival] = drillPrompts([
      { kind: 'gap', id: 1, point: 'th.already', for: 'th.already', before: 'กินข้าว', answer: 'แล้ว', after: '', english: 'Ate already.', wrong: ['เคย', 'จะ', 'กำลัง'], hint: '' },
      { kind: 'gap', id: 2, point: 'th.ever', for: 'th.already', before: 'ฉัน', answer: 'เคย', after: 'ไปภูเก็ต', english: 'I have been to Phuket.', wrong: ['แล้ว', 'จะ', 'กำลัง'], hint: '' },
    ]);
    expect(own.pointId).toBe('th.already');
    expect(rival).toMatchObject({ pointId: 'th.already', answer: 'เคย', label: '' });
  });

  it('leaves a gap on its own point when no point is named', () => {
    const [q] = drillPrompts([{ kind: 'gap', id: 3, point: 'es.preterite', before: 'Ayer ', answer: 'fui', after: '.', english: '', wrong: ['iba', 'voy', 'iré'], hint: '' }]);
    expect(q.pointId).toBe('es.preterite');
  });
});

describe("the Grammar screen's groups", () => {
  const choices = { 'th.already': 'normal', 'th.yes_no': 'practice', 'th.ever': 'unset' } as const;

  it('puts what is due first, then what is coming up, then the points not practiced', () => {
    const answers = drill('th.already', 'a', 12, 5);
    const groups = grammarListGroups('th', choices, answers, NOW, H);
    expect(groups.due.map((r) => r.pointId)).toEqual(['th.yes_no']);
    expect(groups.later.map((r) => r.pointId)).toEqual(['th.already']);
    expect(groups.other.map((r) => r.pointId)).toContain('th.ever');
    expect(groups.other.map((r) => r.pointId)).not.toContain('th.already');
    expect(groups.other.find((r) => r.pointId === 'th.ever')).toMatchObject({ state: 'unset' });
  });

  it('lists every point once', () => {
    const { due, later, other } = grammarListGroups('th', choices, [], NOW, H);
    const ids = [...due, ...later, ...other].map((r) => r.pointId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(10);
  });

  it('counts the points due in each language, most first', () => {
    const many = { 'th.already': 'practice', 'th.yes_no': 'practice', 'es.preterite': 'practice' } as const;
    expect(dueByLanguage(['es', 'th', 'de'], many, [], NOW, H)).toEqual([{ language: 'th', count: 2 }, { language: 'es', count: 1 }]);
    expect(dueByLanguage(['es'], {}, [], NOW, H)).toEqual([]);
  });
});
