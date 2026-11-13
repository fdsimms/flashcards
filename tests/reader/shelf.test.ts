import { describe, expect, it } from 'vitest';
import type { GrammarList, ShelfText } from '../../src/reader/api';
import { cardDetail, grammarStepNote, hasPracticeRoom, minutesFor, nextInOrder, playMinutes, playOrder, reasonLabel, stepGrammarUses, stepLength, surprisePick } from '../../src/reader/shelf';

const text = (over: Partial<ShelfText> = {}): ShelfText => ({
  id: 1, title: 'At the stall', topic: 'Food stall', topic_id: 1, liked: false, form: 'dialogue', lines: 8,
  stretch: [], reason: 'new', coverage: 0.95, episode: 0, ...over,
});

describe('the shelf', () => {
  it('says how long a text takes, never under a minute', () => {
    expect(minutesFor(6)).toBe(2);
    expect(minutesFor(12)).toBe(4);
    expect(minutesFor(1)).toBe(1);
    expect(cardDetail(text({ form: 'story', lines: 12 }))).toBe('Story · 12 lines · 4 min');
  });

  it('says why each text is there', () => {
    expect(reasonLabel(text({ reason: 'due', stretch: ['ร่ม', 'ฝน'] }))).toBe('Uses 2 words you reviewed today');
    expect(reasonLabel(text({ reason: 'due', stretch: ['ร่ม'] }))).toBe('Uses 1 word you reviewed today');
    expect(reasonLabel(text({ reason: 'due' }))).toBe('Written around words you reviewed today');
    expect(reasonLabel(text({ reason: 'liked', topic: 'A scary tiger' }))).toBe('Because you liked "A scary tiger"');
    expect(reasonLabel(text({ reason: 'new' }))).toBe('Something new');
    expect(reasonLabel(text({ reason: 'asked' }))).toBe('You asked for this');
    expect(reasonLabel(text({ reason: 'story', episode: 7 }))).toBe('Episode 7');
    // A text written for a topic before the shelf.
    expect(reasonLabel(text({ reason: '', liked: true }))).toBe('Because you liked "Food stall"');
    expect(reasonLabel(text({ reason: '' }))).toBe('Food stall');
  });

  it('plays the story first, then the shelf in order', () => {
    const shelf = { story: null, texts: [text({ id: 3 }), text({ id: 5, lines: 12 })] };
    expect(playOrder(shelf)).toEqual([3, 5]);
    expect(playMinutes(shelf)).toBe(7);
    const withStory = { ...shelf, story: { id: 1, title: '', about: '', read: 0, last_recap: '', next: text({ id: 9 }), writing: false, failed: null } };
    expect(playOrder(withStory)).toEqual([9, 3, 5]);
    expect(nextInOrder([9, 3, 5], 3)).toBe(5);
    expect(nextInOrder([9, 3, 5], 5)).toBeNull();
    expect(nextInOrder([9, 3, 5], 4)).toBeNull();
  });

  it('steps the length and holds it at the ends', () => {
    expect(stepLength(8, 'shorter')).toBe(6);
    expect(stepLength(8, 'longer')).toBe(12);
    expect(stepLength(6, 'shorter')).toBe(6);
    expect(stepLength(12, 'longer')).toBe(12);
    expect(stepLength(8, 'same')).toBe(8);
  });
});

describe('the grammar dial', () => {
  it('steps the allowance for grammar not marked and holds it between 1 and 4', () => {
    expect(stepGrammarUses(2, 'harder')).toBe(3);
    expect(stepGrammarUses(2, 'simpler')).toBe(1);
    expect(stepGrammarUses(2, 'same')).toBe(2);
    expect(stepGrammarUses(4, 'harder')).toBe(4);
    expect(stepGrammarUses(1, 'simpler')).toBe(1);
  });

  it('says what a step means, and nothing for Same', () => {
    expect(grammarStepNote(2, 2, 'same')).toBeNull();
    expect(grammarStepNote(2, 3, 'harder')).toBe("Texts can use grammar you haven't marked 3 times, up from 2.");
    expect(grammarStepNote(2, 1, 'simpler')).toBe("Texts can use grammar you haven't marked once, down from 2.");
    expect(grammarStepNote(4, 4, 'harder')).toBe("That's as far as it goes: 4 times a text.");
    expect(grammarStepNote(1, 1, 'simpler')).toBe("That's as low as it goes: once a text.");
  });

  it('offers Practice only while fewer than the limit are practiced', () => {
    const list = (states: ('practice' | 'avoid' | 'normal' | 'unset')[]): GrammarList => ({
      max_practice: 2,
      points: states.map((state, i) => ({ id: `es.p${i}`, name: `P${i}`, note: '', state })),
    });
    expect(hasPracticeRoom(list(['practice', 'normal', 'unset']))).toBe(true);
    expect(hasPracticeRoom(list(['practice', 'practice', 'unset']))).toBe(false);
  });
});

describe('Surprise me', () => {
  const ideas = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name, fit: 1 }));

  it('picks from the five best-fitting ideas and either form', () => {
    expect(surprisePick(ideas, () => 0)).toEqual({ name: 'a', form: 'dialogue' });
    expect(surprisePick(ideas, () => 0.999)).toEqual({ name: 'e', form: 'story' });
  });

  it('takes the only idea left, and nothing when there are none', () => {
    expect(surprisePick([{ name: 'a', fit: 0.5 }], () => 0.7)?.name).toBe('a');
    expect(surprisePick([], () => 0.5)).toBeNull();
  });
});
