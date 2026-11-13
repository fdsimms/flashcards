import { describe, expect, it } from 'vitest';
import { activeMisses, missReasonsFor, missReminder, withAnswer, withoutLastAnswer, type MissLog } from '../../src/core/misses';
import { omniNote } from '../support/fixtures';

const THAI = missReasonsFor(omniNote());

describe('which notes offer reasons', () => {
  it('gives Thai its own four', () => {
    expect(THAI.map((r) => r.key)).toEqual(['tone', 'vowel-length', 'spelling', 'meaning']);
  });

  it('gives German, Polish and Russian gender, stress, ending and meaning', () => {
    for (const language of ['German', 'Polish', 'Russian']) {
      expect(missReasonsFor(omniNote({ Language: language, deck: 'x' })).map((r) => r.key)).toEqual(['gender', 'stress', 'ending', 'meaning']);
    }
  });

  it('offers none for a language not listed, or a note that is not Omnilanguage', () => {
    expect(missReasonsFor(omniNote({ Language: 'French' }))).toEqual([]);
    const basic = { ...omniNote(), model: 'Basic', fields: { Front: 'a', Back: 'b' } };
    expect(missReasonsFor(basic)).toEqual([]);
  });
});

describe('active misses', () => {
  it('stays until two answers have come after it', () => {
    expect(activeMisses(['tone'])).toEqual(['tone']);
    expect(activeMisses(['tone', undefined])).toEqual(['tone']);
    expect(activeMisses(['tone', undefined, undefined])).toEqual([]);
  });

  it('starts the count over when the reason is chosen again', () => {
    expect(activeMisses(['tone', undefined, 'tone', undefined])).toEqual(['tone']);
  });

  it('is not cleared by a different reason, and lists the latest first', () => {
    expect(activeMisses(['tone', 'spelling'])).toEqual(['spelling', 'tone']);
    expect(activeMisses(['tone', undefined, 'spelling'])).toEqual(['spelling']);
  });

  it('is empty for a card with no answers or no reasons', () => {
    expect(activeMisses([])).toEqual([]);
    expect(activeMisses([undefined, undefined])).toEqual([]);
  });
});

describe('the reminder', () => {
  it('names one reason, or several', () => {
    expect(missReminder(['tone'], THAI)).toBe('Last time: tone was wrong');
    expect(missReminder(['vowel-length', 'tone'], THAI)).toBe('Last time: tone and vowel length were wrong');
  });

  it('is null with nothing to remind about, or for a reason the language no longer offers', () => {
    expect(missReminder([undefined], THAI)).toBeNull();
    expect(missReminder(['gender'], THAI)).toBeNull();
  });
});

describe('the session log', () => {
  it('adds an answer, and takes the latest back on undo without touching the original', () => {
    const empty: MissLog = new Map();
    const one = withAnswer(empty, 'c1', 'tone');
    const two = withAnswer(one, 'c1', undefined);
    expect(empty.size).toBe(0);
    expect(one.get('c1')).toEqual(['tone']);
    expect(two.get('c1')).toEqual(['tone', undefined]);
    expect(withoutLastAnswer(two, 'c1').get('c1')).toEqual(['tone']);
    expect(two.get('c1')).toEqual(['tone', undefined]);
  });

  it('leaves a card with no answers as it is', () => {
    const log: MissLog = new Map();
    expect(withoutLastAnswer(log, 'c1')).toBe(log);
  });
});
