import { describe, expect, it } from 'vitest';
import type { PracticeRecord } from '../../src/core/forms';
import { knowItReason, pointPractice, practiceSince, suggestKnowIt } from '../../src/core/grammarPage';
import type { Note } from '../../src/core/types';
import { omniNote } from '../support/fixtures';

const H = 4;
const NOW = new Date(2026, 10, 12, 12);
const FORMS = ['present · yo: tengo', 'preterite · yo: tuve', 'preterite · él: tuvo'].join('<br>');
const tener: Note = { ...omniNote({ Entry: 'tener', Meaning: 'to have', Language: 'spanish', Forms: FORMS }), id: 'tener' };
const hablar: Note = { ...omniNote({ Entry: 'hablar', Language: 'spanish', Forms: 'preterite · yo: hablé' }), id: 'hablar' };
const notes = [tener, hablar];
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
const rec = (noteId: string, key: string, correct: boolean, practicedAt = at(11)): PracticeRecord => ({ noteId, key, correct, practicedAt });

describe("a point's Forms practice", () => {
  it("counts only that point's forms, since the start, and names the forms missed most", () => {
    const practice = [
      rec('tener', 'preterite · él', false), rec('tener', 'preterite · él', false), rec('tener', 'preterite · yo', true),
      rec('hablar', 'preterite · yo', false), rec('tener', 'present · yo', false), // the present is no point
      rec('tener', 'preterite · yo', false, at(1)), // before the window
      rec('gone', 'preterite · yo', false), // a note deleted since
    ];
    const got = pointPractice('es.preterite', notes, practice, practiceSince(NOW, H, 10));
    expect(got).toEqual({ answers: 4, right: 1, missed: ['tuvo (tener)', 'hablé (hablar)'] });
  });

  it('starts counting at the start of a study day', () => {
    expect(practiceSince(NOW, H, 1)).toEqual(new Date(2026, 10, 12, 4));
    expect(practiceSince(new Date(2026, 10, 12, 2), H, 1)).toEqual(new Date(2026, 10, 11, 4)); // 2 AM is still yesterday
    expect(practiceSince(NOW, H, 30)).toEqual(new Date(2026, 9, 14, 4));
  });
});

describe('the Know it suggestion', () => {
  const many = (n: number, right: number, day = 11) => Array.from({ length: n }, (_, i) => rec('tener', 'preterite · yo', i < right, at(day)));
  const base = { pointId: 'es.preterite', notes, now: NOW, dayStartsAtHour: H };

  it('needs 20 answers at 90% or more', () => {
    expect(suggestKnowIt({ ...base, state: 'practice', practice: many(20, 18) })).toMatchObject({ answers: 20, right: 18 });
    expect(suggestKnowIt({ ...base, state: 'practice', practice: many(19, 19) })).toBeUndefined();
    expect(suggestKnowIt({ ...base, state: 'unset', practice: many(20, 17) })).toBeUndefined();
  });

  it('is never made for a point already known', () => {
    expect(suggestKnowIt({ ...base, state: 'normal', practice: many(30, 30) })).toBeUndefined();
  });

  it('after Not yet, counts only the answers since', () => {
    const before = many(25, 25, 5);
    expect(suggestKnowIt({ ...base, state: 'practice', practice: before, dismissedAt: at(6) })).toBeUndefined();
    const after = suggestKnowIt({ ...base, state: 'practice', practice: [...before, ...many(20, 20, 10)], dismissedAt: at(6) });
    expect(after).toMatchObject({ answers: 20, sinceNotYet: true });
    // A Not yet from before the window doesn't narrow it.
    expect(suggestKnowIt({ ...base, state: 'practice', practice: before, dismissedAt: new Date(2026, 8, 1).toISOString() })).toBeDefined();
  });

  it('counts grammar drills with Forms practice', () => {
    const drill = Array.from({ length: 12 }, (_, i) => ({ pointId: 'es.preterite', drillId: 'd1', kind: 'gap' as const, correct: i < 11, answeredAt: at(11) }));
    const got = suggestKnowIt({ ...base, state: 'practice', practice: many(10, 10), drillAnswers: drill });
    expect(got).toMatchObject({ answers: 22, right: 21, from: { forms: true, drills: true } });
    expect(knowItReason(got!, 0)).toBe('21 of 22 right in Forms practice and grammar drills over the last 30 days.');
    const other = drill.map((a) => ({ ...a, pointId: 'es.imperfect' }));
    expect(suggestKnowIt({ ...base, state: 'practice', practice: many(10, 10), drillAnswers: other })).toBeUndefined();
  });

  it('says why, and over which answers', () => {
    expect(knowItReason({ answers: 48, right: 41, missed: [], sinceNotYet: false, from: { forms: true, drills: false } }, 9))
      .toBe('41 of 48 right in Forms practice over the last 30 days, and in 9 texts you read.');
    expect(knowItReason({ answers: 20, right: 20, missed: [], sinceNotYet: true, from: { forms: true, drills: false } }, 1))
      .toBe('20 of 20 right in Forms practice since you last chose Not yet, and in 1 text you read.');
    expect(knowItReason({ answers: 20, right: 19, missed: [], sinceNotYet: false, from: { forms: true, drills: false } }, 0))
      .toBe('19 of 20 right in Forms practice over the last 30 days.');
  });
});
