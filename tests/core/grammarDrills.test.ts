import { describe, expect, it } from 'vitest';
import { anyDrilled, drillPrompts, dueWhen, duePoints, drillResults, isDrilled, missingNote, pointSchedule, scheduledPoints, type GrammarAnswer } from '../../src/core/grammarDrills';

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
    expect(pointSchedule('es.preterite', 'practice', answers, NOW, H)).toMatchObject({ due: day(9), step: 0 });
  });

  it('spaces a known point further, and still brings it back the next day after a drill that went badly', () => {
    expect(pointSchedule('es.preterite', 'normal', drill('es.preterite', 'a', 1, 5), NOW, H).due).toEqual(day(8));
    expect(pointSchedule('es.preterite', 'normal', drill('es.preterite', 'a', 10, 1), NOW, H)).toMatchObject({ due: day(11), step: 0 });
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

  it('knows whether any language has a drilled point', () => {
    expect(anyDrilled(['es', 'th'], choices)).toBe(true);
    expect(anyDrilled(['de'], choices)).toBe(false);
    expect(anyDrilled(['es'], { 'es.future': 'avoid', 'es.conditional': 'unset' })).toBe(false);
    expect(anyDrilled(['es'], { 'es.gone': 'practice' })).toBe(false);
    expect(anyDrilled(['es'], {})).toBe(false);
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
