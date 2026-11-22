import { describe, expect, it } from 'vitest';
import { isDrillQuestion, mergeRounds, parseRounds, questionsToAsk, roundOf, withCarry, withRound, type CardRounds } from '../../src/tools/drillRound';
import { DRILL_STEPS, drawRound, drillStep, type DrillQuestion } from '../../src/tools/skills';

const step = drillStep('time-hours')!;
const round = (): DrillQuestion[] => drawRound(step, Math.random, 'th');
const DAY = '2026-11-22';

describe("a card's questions for the study day", () => {
  it('are found again on the same day and step, and not on another', () => {
    const r = round();
    const rounds = withRound({}, '7', DAY, step.id, r);
    expect(roundOf(rounds, '7', DAY, step.id)?.round).toEqual(r);
    expect(roundOf(rounds, '7', '2026-11-23', step.id)).toBeUndefined();
    expect(roundOf(rounds, '7', DAY, 'another-step')).toBeUndefined();
    expect(roundOf(rounds, '8', DAY, step.id)).toBeUndefined();
  });

  it('ask the whole round, then only what was missed once something is carried', () => {
    const r = round();
    let rounds = withRound({}, '7', DAY, step.id, r);
    expect(questionsToAsk(rounds['7'])).toEqual(r);
    rounds = withCarry(rounds, '7', [r[1]]);
    expect(questionsToAsk(rounds['7'])).toEqual([r[1]]);
    // Rated Good: the carry goes, and the same round is what's left.
    rounds = withCarry(rounds, '7', []);
    expect(questionsToAsk(rounds['7'])).toEqual(r);
  });

  it('put a carry back as it was, for an undo', () => {
    const r = round();
    const before = withCarry(withRound({}, '7', DAY, step.id, r), '7', [r[0]]);
    const after = withCarry(before, '7', []);
    expect(questionsToAsk(withCarry(after, '7', before['7'].carry)['7'])).toEqual([r[0]]);
  });

  it('change nothing for a card with no record', () => {
    const rounds: CardRounds = {};
    expect(withCarry(rounds, '7', round())).toBe(rounds);
  });

  it('drop every record from an earlier day when a new round is kept', () => {
    let rounds = withRound({}, '1', '2026-11-21', step.id, round());
    rounds = withRound(rounds, '2', DAY, step.id, round());
    rounds = withRound(rounds, '3', DAY, step.id, round());
    expect(Object.keys(rounds).sort()).toEqual(['2', '3']);
  });

  it('draw a new round each day', () => {
    // 48 times, 3 asked: two days running giving the same three is about 1 in 100,000.
    let same = 0;
    for (let i = 0; i < 20; i++) {
      const a = withRound({}, '7', DAY, step.id, round());
      const b = withRound(a, '7', '2026-11-23', step.id, round());
      if (JSON.stringify(a['7'].round) === JSON.stringify(b['7'].round)) same++;
    }
    expect(same).toBe(0);
  });
});

describe('reading the file back', () => {
  it('keeps what survives a save and read, for every kind of question', () => {
    const rounds = withRound({}, '7', DAY, step.id, round());
    expect(parseRounds(JSON.parse(JSON.stringify(rounds)))).toEqual(rounds);
  });

  it('drops a record that is not whole, and a question this version cannot show', () => {
    const r = round();
    const raw = {
      ok: { day: DAY, stepId: step.id, round: r, carry: [r[0], { kind: 'time' }, 'x'] },
      noRound: { day: DAY, stepId: step.id, round: [], carry: [] },
      badQuestion: { day: DAY, stepId: step.id, round: [r[0], { kind: 'weather' }], carry: [] },
      noDay: { stepId: step.id, round: r, carry: [] },
      text: 'x',
    };
    const parsed = parseRounds(raw);
    expect(Object.keys(parsed)).toEqual(['ok']);
    expect(parsed.ok.carry).toEqual([r[0]]);
    expect(parseRounds(null)).toEqual({});
    expect(parseRounds([1])).toEqual({});
  });

  it('accepts every kind of question a step draws', () => {
    for (const s of DRILL_STEPS) for (const q of drawRound(s, Math.random, 'pl')) expect(isDrillQuestion(JSON.parse(JSON.stringify(q)))).toBe(true);
  });

  it('keeps a round made before the file was read over the one in it', () => {
    const stored = withRound({}, '7', DAY, step.id, round());
    const fresh = withRound({}, '7', DAY, step.id, round());
    expect(mergeRounds(stored, fresh)['7']).toBe(fresh['7']);
    expect(Object.keys(mergeRounds(stored, withRound({}, '8', DAY, step.id, round()))).sort()).toEqual(['7', '8']);
  });
});
