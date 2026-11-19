import { describe, expect, it } from 'vitest';
import { DRILL_STEPS, drawQuestion, drillAnswer, drillStep, hasDrills, NUMBER_STEPS, questionKey, suggestedRating, TIME_STEPS } from '../../src/tools/skills';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('skill drills', () => {
  it('gives every step a unique id, and each later step the one before it', () => {
    expect(new Set(DRILL_STEPS.map((s) => s.id)).size).toBe(DRILL_STEPS.length);
    for (const ladder of [TIME_STEPS, NUMBER_STEPS]) {
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
